import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listLatePaymentFees,
  createLatePaymentFee,
  updateLatePaymentFee,
  deleteLatePaymentFee,
} from '../repositories/LatePaymentFeeRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  LatePaymentFeeCreateSchema,
  LatePaymentFeeUpdateSchema,
  LatePaymentFeeListQuerySchema,
  LatePaymentFeeResponseSchema,
  LatePaymentFeeSingleResponseSchema,
  LatePaymentFeeParamsSchema,
} from '../schemas/LatePaymentFee.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

// Late Payment Fee hanya catatan: tidak memposting jurnal dan tidak memengaruhi piutang.
// Write dibuka untuk admin + accountant.
export const latePaymentFeeRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/late-payment-fees', {
    schema: {
      tags: ['LatePaymentFee'],
      operationId: 'listLatePaymentFees',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: LatePaymentFeeListQuerySchema,
      response: { 200: createPaginatedResponseSchema(LatePaymentFeeResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listLatePaymentFees(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/late-payment-fees', {
    schema: {
      tags: ['LatePaymentFee'],
      operationId: 'createLatePaymentFee',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: LatePaymentFeeCreateSchema,
      response: { 201: LatePaymentFeeSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createLatePaymentFee(req.params.businessId, req.body);
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      if (error === 'INVALID_INVOICE') return sendError(res, 400, 'BadRequest', "Faktur tidak ditemukan di bisnis ini atau belum berstatus 'sent'");
      if (error === 'INVOICE_CUSTOMER_MISMATCH') return sendError(res, 400, 'BadRequest', 'Faktur ini bukan milik pelanggan yang dipilih');
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/late-payment-fees/:latePaymentFeeId', {
    schema: {
      tags: ['LatePaymentFee'],
      operationId: 'updateLatePaymentFee',
      security: [{ bearerAuth: [] }],
      params: LatePaymentFeeParamsSchema,
      body: LatePaymentFeeUpdateSchema,
      response: { 200: LatePaymentFeeSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateLatePaymentFee(req.params.businessId, req.params.latePaymentFeeId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Denda keterlambatan tidak ditemukan');
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      if (error === 'INVALID_INVOICE') return sendError(res, 400, 'BadRequest', "Faktur tidak ditemukan di bisnis ini atau belum berstatus 'sent'");
      if (error === 'INVOICE_CUSTOMER_MISMATCH') return sendError(res, 400, 'BadRequest', 'Faktur ini bukan milik pelanggan yang dipilih');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/late-payment-fees/:latePaymentFeeId', {
    schema: {
      tags: ['LatePaymentFee'],
      operationId: 'deleteLatePaymentFee',
      security: [{ bearerAuth: [] }],
      params: LatePaymentFeeParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const deleted = await deleteLatePaymentFee(req.params.businessId, req.params.latePaymentFeeId);
      if (!deleted) return sendError(res, 404, 'NotFound', 'Denda keterlambatan tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};