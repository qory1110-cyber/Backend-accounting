import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listPurchaseInvoices,
  getPurchaseInvoiceById,
  getPurchaseInvoiceTotals,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  deletePurchaseInvoice,
  approvePurchaseInvoice,
  voidPurchaseInvoice,
} from '../repositories/PurchaseInvoiceRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceUpdateSchema,
  PurchaseInvoiceResponseSchema,
  PurchaseInvoiceListResponseSchema,
  PurchaseInvoiceTotalsResponseSchema,
  PurchaseInvoiceSingleResponseSchema,
  PurchaseInvoiceParamsSchema,
} from '../schemas/PurchaseInvoice.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// §1.2: Staf Pembelian atau Admin - WRITE dibuka untuk admin + accountant, sama seperti Sales Invoices.
export const purchaseInvoiceRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/purchase-invoices', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'listPurchaseInvoices',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(PurchaseInvoiceResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listPurchaseInvoices(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/purchase-invoices/totals', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'getPurchaseInvoiceTotals',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: PurchaseInvoiceTotalsResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await getPurchaseInvoiceTotals(req.params.businessId)),
  });

  app.post('/:businessId/purchase-invoices', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'createPurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: PurchaseInvoiceCreateSchema,
      response: { 201: PurchaseInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createPurchaseInvoice(req.params.businessId, req.body);
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', 'Pemasok tidak valid atau bukan pemasok di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Expense di bisnis ini');
      if (error === 'INVALID_PURCHASE_ORDER') return sendError(res, 400, 'BadRequest', 'Purchase Order tidak ditemukan di bisnis ini');
      if (error === 'PO_SUPPLIER_MISMATCH') return sendError(res, 400, 'BadRequest', 'Pemasok faktur harus sama dengan pemasok pada Purchase Order');
      if (error === 'INVALID_PO_LINE') return sendError(res, 400, 'BadRequest', 'Baris rincian menunjuk baris Purchase Order yang tidak valid');
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/purchase-invoices/:purchaseInvoiceId', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'getPurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: PurchaseInvoiceParamsSchema,
      response: { 200: PurchaseInvoiceSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getPurchaseInvoiceById(req.params.businessId, req.params.purchaseInvoiceId);
      if (!row) return sendError(res, 404, 'NotFound', 'Faktur pembelian tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/purchase-invoices/:purchaseInvoiceId', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'updatePurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: PurchaseInvoiceParamsSchema,
      body: PurchaseInvoiceUpdateSchema,
      response: { 200: PurchaseInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updatePurchaseInvoice(req.params.businessId, req.params.purchaseInvoiceId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Faktur pembelian tidak ditemukan');
      if (error === 'NOT_DRAFT') return sendError(res, 409, 'Conflict', 'Faktur yang sudah disetujui tidak bisa diedit');
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', 'Pemasok tidak valid atau bukan pemasok di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Expense di bisnis ini');
      if (error === 'INVALID_PURCHASE_ORDER') return sendError(res, 400, 'BadRequest', 'Purchase Order tidak ditemukan di bisnis ini');
      if (error === 'PO_SUPPLIER_MISMATCH') return sendError(res, 400, 'BadRequest', 'Pemasok faktur harus sama dengan pemasok pada Purchase Order');
      if (error === 'INVALID_PO_LINE') return sendError(res, 400, 'BadRequest', 'Baris rincian menunjuk baris Purchase Order yang tidak valid');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/purchase-invoices/:purchaseInvoiceId', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'deletePurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: PurchaseInvoiceParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deletePurchaseInvoice(req.params.businessId, req.params.purchaseInvoiceId);
      if (result.blocked) return sendError(res, 409, 'Conflict', 'Faktur yang sudah disetujui tidak bisa dihapus, gunakan Void');
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Faktur pembelian tidak ditemukan');
      return res.code(204).send(null);
    },
  });

  app.post('/:businessId/purchase-invoices/:purchaseInvoiceId/approve', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'approvePurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: PurchaseInvoiceParamsSchema,
      response: { 200: PurchaseInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await approvePurchaseInvoice(req.params.businessId, req.params.purchaseInvoiceId);
      const { result, error } = out;
      if (error === null && !result) return sendError(res, 404, 'NotFound', 'Faktur pembelian tidak ditemukan');
      if (error === 'STATUS_NOT_DRAFT') return sendError(res, 409, 'Conflict', 'Faktur ini sudah disetujui atau dibatalkan');
      if (error === 'NO_LINES') return sendError(res, 400, 'BadRequest', 'Faktur harus punya minimal 1 baris rincian');
      if (error === 'NO_AP_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Utang Usaha (kode 2000) tidak ditemukan di Chart of Accounts');
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'create'));
      return sendData(res, result);
    },
  });

  app.post('/:businessId/purchase-invoices/:purchaseInvoiceId/void', {
    schema: {
      tags: ['PurchaseInvoice'],
      operationId: 'voidPurchaseInvoice',
      security: [{ bearerAuth: [] }],
      params: PurchaseInvoiceParamsSchema,
      response: { 200: PurchaseInvoiceSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
        handler: async (req, res) => {
      const out = await voidPurchaseInvoice(req.params.businessId, req.params.purchaseInvoiceId);
      const { result, error } = out;
      if (error === null && !result) return sendError(res, 404, 'NotFound', 'Faktur pembelian tidak ditemukan');
      if (error === 'STATUS_NOT_APPROVED') return sendError(res, 409, 'Conflict', "Cuma faktur berstatus 'approved' yang bisa di-void");
      if (error === 'HAS_PAYMENTS') return sendError(res, 409, 'Conflict', 'Faktur ini sudah memiliki pembayaran. Hapus pembayarannya terlebih dahulu sebelum void');
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'void'));
      return sendData(res, result);
    },
  });
};