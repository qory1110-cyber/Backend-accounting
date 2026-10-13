import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listSalesInvoices,
  getSalesInvoiceById,
  getSalesInvoiceTotals,
  createSalesInvoice,
  updateSalesInvoice,
  deleteSalesInvoice,
  sendSalesInvoice,
  voidSalesInvoice,
} from '../repositories/SalesInvoiceRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  SalesInvoiceCreateSchema,
  SalesInvoiceUpdateSchema,
  SalesInvoiceResponseSchema,
  SalesInvoiceListResponseSchema,
  SalesInvoiceSingleResponseSchema,
  SalesInvoiceTotalsResponseSchema,
  SalesInvoiceParamsSchema,
} from '../schemas/SalesInvoice.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// §10.2: Admin & Staf Penjualan sama-sama bisa buat/kirim faktur - WRITE dibuka untuk admin+accountant.
export const salesInvoiceRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/sales-invoices', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'listSalesInvoices',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(SalesInvoiceResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listSalesInvoices(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/sales-invoices', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'createSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: SalesInvoiceCreateSchema,
      response: { 201: SalesInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createSalesInvoice(req.params.businessId, req.body);
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid atau bukan pelanggan di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Income di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/sales-invoices/:salesInvoiceId', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'getSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: SalesInvoiceParamsSchema,
      response: { 200: SalesInvoiceSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getSalesInvoiceById(req.params.businessId, req.params.salesInvoiceId);
      if (!row) return sendError(res, 404, 'NotFound', 'Faktur tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.get('/:businessId/sales-invoices/totals', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'getSalesInvoiceTotals',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: SalesInvoiceTotalsResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await getSalesInvoiceTotals(req.params.businessId)),
  });

  app.patch('/:businessId/sales-invoices/:salesInvoiceId', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'updateSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: SalesInvoiceParamsSchema,
      body: SalesInvoiceUpdateSchema,
      response: { 200: SalesInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateSalesInvoice(req.params.businessId, req.params.salesInvoiceId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Faktur tidak ditemukan');
      if (error === 'NOT_DRAFT') return sendError(res, 409, 'Conflict', 'Faktur yang sudah dikirim tidak bisa diedit');
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid atau bukan pelanggan di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Income di bisnis ini');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/sales-invoices/:salesInvoiceId', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'deleteSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: SalesInvoiceParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteSalesInvoice(req.params.businessId, req.params.salesInvoiceId);
      if (result.blocked) return sendError(res, 409, 'Conflict', 'Faktur yang sudah dikirim tidak bisa dihapus, gunakan Void');
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Faktur tidak ditemukan');
      return res.code(204).send(null);
    },
  });

  app.post('/:businessId/sales-invoices/:salesInvoiceId/send', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'sendSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: SalesInvoiceParamsSchema,
      response: { 200: SalesInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await sendSalesInvoice(req.params.businessId, req.params.salesInvoiceId);
      const { result, error } = out;
      if (error === null && !result) return sendError(res, 404, 'NotFound', 'Faktur tidak ditemukan');
      if (error === 'STATUS_NOT_DRAFT') return sendError(res, 409, 'Conflict', 'Faktur ini sudah dikirim atau dibatalkan');
      if (error === 'NO_LINES') return sendError(res, 400, 'BadRequest', 'Faktur harus punya minimal 1 baris rincian');
      if (error === 'NO_AR_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Piutang Usaha (kode 1200) tidak ditemukan di Chart of Accounts');
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'create'));
      return sendData(res, result);
    },
  });

  app.post('/:businessId/sales-invoices/:salesInvoiceId/void', {
    schema: {
      tags: ['SalesInvoice'],
      operationId: 'voidSalesInvoice',
      security: [{ bearerAuth: [] }],
      params: SalesInvoiceParamsSchema,
      response: { 200: SalesInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
        handler: async (req, res) => {
      const out = await voidSalesInvoice(req.params.businessId, req.params.salesInvoiceId);
      const { result, error } = out;
      if (error === null && !result) return sendError(res, 404, 'NotFound', 'Faktur tidak ditemukan');
      if (error === 'STATUS_NOT_SENT') return sendError(res, 409, 'Conflict', "Cuma faktur berstatus 'sent' yang bisa di-void");
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'void'));
      return sendData(res, result);
    },
  });
};