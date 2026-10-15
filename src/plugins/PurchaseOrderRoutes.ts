import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
} from '../repositories/PurchaseOrderRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  PurchaseOrderCreateSchema,
  PurchaseOrderUpdateSchema,
  PurchaseOrderListQuerySchema,
  PurchaseOrderResponseSchema,
  PurchaseOrderSingleResponseSchema,
  PurchaseOrderParamsSchema,
} from '../schemas/PurchaseOrder.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

// PO tidak memposting jurnal. Write dibuka untuk admin + accountant, sama seperti Purchase Invoices.
export const purchaseOrderRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/purchase-orders', {
    schema: {
      tags: ['PurchaseOrder'],
      operationId: 'listPurchaseOrders',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PurchaseOrderListQuerySchema,
      response: { 200: createPaginatedResponseSchema(PurchaseOrderResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listPurchaseOrders(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/purchase-orders/:purchaseOrderId', {
    schema: {
      tags: ['PurchaseOrder'],
      operationId: 'getPurchaseOrder',
      security: [{ bearerAuth: [] }],
      params: PurchaseOrderParamsSchema,
      response: { 200: PurchaseOrderSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getPurchaseOrderById(req.params.businessId, req.params.purchaseOrderId);
      if (!row) return sendError(res, 404, 'NotFound', 'Pesanan pembelian tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/purchase-orders', {
    schema: {
      tags: ['PurchaseOrder'],
      operationId: 'createPurchaseOrder',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: PurchaseOrderCreateSchema,
      response: { 201: PurchaseOrderSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createPurchaseOrder(req.params.businessId, req.body);
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', 'Pemasok tidak valid, tidak aktif, atau bukan pemasok di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Expense di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/purchase-orders/:purchaseOrderId', {
    schema: {
      tags: ['PurchaseOrder'],
      operationId: 'updatePurchaseOrder',
      security: [{ bearerAuth: [] }],
      params: PurchaseOrderParamsSchema,
      body: PurchaseOrderUpdateSchema,
      response: { 200: PurchaseOrderSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updatePurchaseOrder(req.params.businessId, req.params.purchaseOrderId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Pesanan pembelian tidak ditemukan');
      if (error === 'HAS_INVOICES') return sendError(res, 409, 'Conflict', 'Pesanan ini sudah memiliki faktur, sehingga pemasok dan rinciannya tidak bisa diubah');
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', 'Pemasok tidak valid, tidak aktif, atau bukan pemasok di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Expense di bisnis ini');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/purchase-orders/:purchaseOrderId', {
    schema: {
      tags: ['PurchaseOrder'],
      operationId: 'deletePurchaseOrder',
      security: [{ bearerAuth: [] }],
      params: PurchaseOrderParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deletePurchaseOrder(req.params.businessId, req.params.purchaseOrderId);
      if (result.blocked) return sendError(res, 409, 'Conflict', 'Pesanan ini sudah memiliki faktur, tidak bisa dihapus');
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Pesanan pembelian tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};