import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listPayments,
  getPaymentById,
  getPaymentTotals,
  createPayment,
  setPaymentCleared,
  deletePayment,
} from '../repositories/PaymentRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  PaymentCreateSchema,
  PaymentResponseSchema,
  PaymentListResponseSchema,
  PaymentSingleResponseSchema,
  PaymentParamsSchema,
  PaymentListQuerySchema,
  PaymentTotalsResponseSchema,
  SetPaymentClearedSchema,
} from '../schemas/Payment.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// §2.2: Staf Keuangan mencatat - WRITE untuk admin + accountant, sama seperti Receipts.
export const paymentRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/payments', {
    schema: {
      tags: ['Payment'],
      operationId: 'listPayments',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaymentListQuerySchema,
      response: { 200: PaymentListResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listPayments(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/payments/totals', {
    schema: {
      tags: ['Payment'],
      operationId: 'getPaymentTotals',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: PaymentTotalsResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await getPaymentTotals(req.params.businessId)),
  });

  app.post('/:businessId/payments', {
    schema: {
      tags: ['Payment'],
      operationId: 'createPayment',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: PaymentCreateSchema,
      response: { 201: PaymentSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const outcome = await createPayment(req.params.businessId, req.body);
      if (outcome.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(outcome.lockedUntil, 'create'));
      }
      const { result, error } = outcome;
      if (error === 'INVALID_BANK_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun bank/kas sumber dana tidak valid');
      if (error === 'INVALID_PAYEE') return sendError(res, 400, 'BadRequest', 'Payee tidak valid di bisnis ini');
      if (error === 'NO_AP_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Utang Usaha (kode 2000) tidak ditemukan');
      if (error === 'INVALID_INVOICE') return sendError(res, 400, 'BadRequest', 'Faktur tidak valid atau bukan berstatus approved');
      if (error === 'INVALID_CLAIM') return sendError(res, 400, 'BadRequest', 'Klaim biaya tidak valid di bisnis ini');
      if (error === 'CLAIM_PAYEE_MISMATCH') return sendError(res, 400, 'BadRequest', 'Payee pembayaran harus Payer pemilik klaim biaya tersebut');
      if (error === 'OVERPAYMENT') return sendError(res, 400, 'BadRequest', 'Jumlah melebihi sisa tagihan faktur/klaim');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun GL tidak valid di bisnis ini');
      if (error === 'INVALID_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek pada baris tidak valid di bisnis ini');
      if (error === 'INACTIVE_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek berstatus Inactive atau Completed, pilih proyek yang Active');
      if (error === 'ACCOUNT_SAME_AS_BANK') return sendError(res, 400, 'BadRequest', 'Akun pada baris tidak boleh sama dengan akun kontrol bank. Pilih akun tujuan, misalnya Beban atau Utang Usaha');
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/payments/:paymentId', {
    schema: {
      tags: ['Payment'],
      operationId: 'getPayment',
      security: [{ bearerAuth: [] }],
      params: PaymentParamsSchema,
      response: { 200: PaymentSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getPaymentById(req.params.businessId, req.params.paymentId);
      if (!row) return sendError(res, 404, 'NotFound', 'Pembayaran tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/payments/:paymentId/cleared', {
    schema: {
      tags: ['Payment'],
      operationId: 'setPaymentCleared',
      security: [{ bearerAuth: [] }],
      params: PaymentParamsSchema,
      body: SetPaymentClearedSchema,
      response: { 200: PaymentSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const row = await setPaymentCleared(req.params.businessId, req.params.paymentId, req.body.cleared);
      if (!row) return sendError(res, 404, 'NotFound', 'Pembayaran tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/payments/:paymentId', {
    schema: {
      tags: ['Payment'],
      operationId: 'deletePayment',
      security: [{ bearerAuth: [] }],
      params: PaymentParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deletePayment(req.params.businessId, req.params.paymentId);
            if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Pembayaran tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};