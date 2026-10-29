import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listSalesOrders,
  getSalesOrderById,
  createSalesOrder,
  updateSalesOrder,
  deleteSalesOrder,
} from '../repositories/SalesOrderRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  SalesOrderCreateSchema,
  SalesOrderUpdateSchema,
  SalesOrderListQuerySchema,
  SalesOrderResponseSchema,
  SalesOrderSingleResponseSchema,
  SalesOrderParamsSchema,
} from '../schemas/SalesOrder.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

// Sales Order tidak memposting jurnal. Write dibuka untuk admin + accountant.
export const salesOrderRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/sales-orders', {
    schema: {
      tags: ['SalesOrder'],
      operationId: 'listSalesOrders',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: SalesOrderListQuerySchema,
      response: { 200: createPaginatedResponseSchema(SalesOrderResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listSalesOrders(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/sales-orders/:salesOrderId', {
    schema: {
      tags: ['SalesOrder'],
      operationId: 'getSalesOrder',
      security: [{ bearerAuth: [] }],
      params: SalesOrderParamsSchema,
      response: { 200: SalesOrderSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getSalesOrderById(req.params.businessId, req.params.salesOrderId);
      if (!row) return sendError(res, 404, 'NotFound', 'Pesanan penjualan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/sales-orders', {
    schema: {
      tags: ['SalesOrder'],
      operationId: 'createSalesOrder',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: SalesOrderCreateSchema,
      response: { 201: SalesOrderSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createSalesOrder(req.params.businessId, req.body);
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/sales-orders/:salesOrderId', {
    schema: {
      tags: ['SalesOrder'],
      operationId: 'updateSalesOrder',
      security: [{ bearerAuth: [] }],
      params: SalesOrderParamsSchema,
      body: SalesOrderUpdateSchema,
      response: { 200: SalesOrderSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateSalesOrder(req.params.businessId, req.params.salesOrderId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Pesanan penjualan tidak ditemukan');
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/sales-orders/:salesOrderId', {
    schema: {
      tags: ['SalesOrder'],
      operationId: 'deleteSalesOrder',
      security: [{ bearerAuth: [] }],
      params: SalesOrderParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteSalesOrder(req.params.businessId, req.params.salesOrderId);
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Pesanan penjualan tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};