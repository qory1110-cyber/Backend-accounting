import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listBillableTimes,
  getBillableTimeById,
  createBillableTime,
  updateBillableTime,
  deleteBillableTime,
  invoiceBillableTimes,
} from '../repositories/BillableTimeRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import { periodLockedMessage } from '../libs/period-lock.js';
import {
  BillableTimeCreateSchema,
  BillableTimeUpdateSchema,
  BillableTimeListQuerySchema,
  BillableTimeResponseSchema,
  BillableTimeSingleResponseSchema,
  BillableTimeParamsSchema,
  BillableTimeInvoiceBodySchema,
  BillableTimeInvoiceResponseSchema,
} from '../schemas/BillableTime.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CUSTOMER: 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini',
  NOT_EDITABLE: 'Hanya Billable Time berstatus Uninvoiced yang dapat diubah',
  ALREADY_INVOICED: 'Billable Time yang sudah ditagihkan tidak dapat dihapus',
  ITEM_NOT_FOUND: 'Ada Billable Time yang tidak ditemukan di bisnis ini',
  CUSTOMER_MISMATCH: 'Semua Billable Time harus milik pelanggan yang dipilih',
  NOT_UNINVOICED: 'Semua Billable Time harus berstatus Uninvoiced',
  ZERO_TOTAL: 'Total tagihan harus lebih dari 0',
  NO_AR_ACCOUNT: 'Akun Piutang Usaha (1200) tidak ditemukan di bisnis ini',
};

// Billable Time memposting jurnal. Write dibuka untuk admin + accountant.
export const billableTimeRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/billable-times', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'listBillableTimes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: BillableTimeListQuerySchema,
      response: { 200: createPaginatedResponseSchema(BillableTimeResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, status, customerId, dateFrom, dateTo } = req.query;
      const { data, total } = await listBillableTimes(req.params.businessId, page, pageSize, {
        search,
        status,
        customerId,
        dateFrom,
        dateTo,
      });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/billable-times/:billableTimeId', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'getBillableTime',
      security: [{ bearerAuth: [] }],
      params: BillableTimeParamsSchema,
      response: { 200: BillableTimeSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getBillableTimeById(req.params.businessId, req.params.billableTimeId);
      if (!row) return sendError(res, 404, 'NotFound', 'Billable Time tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/billable-times', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'createBillableTime',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: BillableTimeCreateSchema,
      response: { 201: BillableTimeSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error, lockedUntil } = await createBillableTime(req.params.businessId, req.body);
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'create'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/billable-times/:billableTimeId', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'updateBillableTime',
      security: [{ bearerAuth: [] }],
      params: BillableTimeParamsSchema,
      body: BillableTimeUpdateSchema,
      response: { 200: BillableTimeSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error, lockedUntil } = await updateBillableTime(
        req.params.businessId,
        req.params.billableTimeId,
        req.body,
      );
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Billable Time tidak ditemukan');
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'create'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/billable-times/:billableTimeId', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'deleteBillableTime',
      security: [{ bearerAuth: [] }],
      params: BillableTimeParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { deleted, error, lockedUntil } = await deleteBillableTime(req.params.businessId, req.params.billableTimeId);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Billable Time tidak ditemukan');
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'delete'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      if (!deleted) return sendError(res, 404, 'NotFound', 'Billable Time tidak ditemukan');
      return res.code(204).send(null);
    },
  });

  // Penagihan: buat Sales Invoice dari Billable Time Uninvoiced milik satu pelanggan.
  app.post('/:businessId/billable-times/invoice', {
    schema: {
      tags: ['BillableTime'],
      operationId: 'invoiceBillableTimes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: BillableTimeInvoiceBodySchema,
      response: { 201: BillableTimeInvoiceResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error, lockedUntil } = await invoiceBillableTimes(req.params.businessId, req.body);
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'create'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result, 201);
    },
  });
};