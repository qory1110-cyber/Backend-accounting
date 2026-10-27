import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createReceipt, listReceipts, getReceiptById, deleteReceipt, getReceiptTotals, setReceiptCleared, } from '../repositories/ReceiptRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  ReceiptCreateSchema,
  ReceiptResponseSchema,
  SetReceiptClearedSchema,
  ReceiptListResponseSchema,
  ReceiptTotalsResponseSchema,
  ReceiptSingleResponseSchema,
  ReceiptParamsSchema,
} from '../schemas/Receipt.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';
import { z } from 'zod';
import { periodLockedMessage } from '../libs/period-lock.js';

// §3.2: Staf Keuangan mencatat, Admin memverifikasi - WRITE untuk admin + accountant,
// sama seperti Sales/Purchase Invoices. Tidak ada endpoint update, sesuai §3.5:
// Receipt langsung final, koreksi lewat hapus (yang memposting jurnal pembalik).
export const receiptRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/receipts', {
    schema: {
      tags: ['Receipt'],
      operationId: 'listReceipts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(ReceiptResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listReceipts(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/receipts/totals', {
    schema: {
      tags: ['Receipt'],
      operationId: 'getReceiptTotals',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: ReceiptTotalsResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await getReceiptTotals(req.params.businessId)),
  });

  app.post('/:businessId/receipts', {
    schema: {
      tags: ['Receipt'],
      operationId: 'createReceipt',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: ReceiptCreateSchema,
      response: { 201: ReceiptSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
            const outcome = await createReceipt(req.params.businessId, req.body);
      if (outcome.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(outcome.lockedUntil, 'create'));
      }
      const { result, error } = outcome;
      if (error === 'INVALID_BANK_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun bank/kas tujuan tidak valid');
      if (error === 'NO_AR_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Piutang Usaha (kode 1200) tidak ditemukan');
      if (error === 'INVALID_INVOICE') return sendError(res, 400, 'BadRequest', 'Faktur tidak valid atau bukan berstatus sent');
      if (error === 'OVERPAYMENT') return sendError(res, 400, 'BadRequest', 'Jumlah melebihi sisa tagihan faktur');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun GL tidak valid di bisnis ini');
      if (error === 'INVALID_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek pada baris tidak valid di bisnis ini');
      if (error === 'INACTIVE_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek berstatus Inactive atau Completed, pilih proyek yang Active');
      if (error === 'ACCOUNT_SAME_AS_BANK') return sendError(res, 400, 'BadRequest', 'Akun pada baris tidak boleh sama dengan akun kontrol bank. Pilih akun sumber, misalnya Pendapatan atau Piutang Usaha');
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/receipts/:receiptId', {
    schema: {
      tags: ['Receipt'],
      operationId: 'getReceipt',
      security: [{ bearerAuth: [] }],
      params: ReceiptParamsSchema,
      response: { 200: ReceiptSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getReceiptById(req.params.businessId, req.params.receiptId);
      if (!row) return sendError(res, 404, 'NotFound', 'Penerimaan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/receipts/:receiptId', {
    schema: {
      tags: ['Receipt'],
      operationId: 'deleteReceipt',
      security: [{ bearerAuth: [] }],
      params: ReceiptParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteReceipt(req.params.businessId, req.params.receiptId);
            if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Penerimaan tidak ditemukan');
      return res.code(204).send(null);
    },
  });

    app.patch('/:businessId/receipts/:receiptId/cleared', {
    schema: {
      tags: ['Receipt'],
      operationId: 'setReceiptCleared',
      security: [{ bearerAuth: [] }],
      params: ReceiptParamsSchema,
      body: SetReceiptClearedSchema,
      response: { 200: ReceiptSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const row = await setReceiptCleared(req.params.businessId, req.params.receiptId, req.body.cleared);
      if (!row) return sendError(res, 404, 'NotFound', 'Penerimaan tidak ditemukan');
      return sendData(res, row);
    },
  });
};