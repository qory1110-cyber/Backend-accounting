import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  updateGoodsReceipt,
  deleteGoodsReceipt,
} from '../repositories/GoodsReceiptRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  GoodsReceiptCreateSchema,
  GoodsReceiptUpdateSchema,
  GoodsReceiptListQuerySchema,
  GoodsReceiptResponseSchema,
  GoodsReceiptSingleResponseSchema,
  GoodsReceiptParamsSchema,
} from '../schemas/GoodsReceipt.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

const ERROR_MESSAGES = {
  INVALID_SUPPLIER: 'Pemasok tidak valid, tidak aktif, atau bukan pemasok di bisnis ini',
  INVALID_ORDER: 'Purchase Order tidak ditemukan di bisnis ini',
  ORDER_SUPPLIER_MISMATCH: 'Purchase Order bukan milik pemasok yang dipilih',
  INVALID_INVOICE: 'Purchase Invoice tidak ditemukan di bisnis ini',
  INVOICE_SUPPLIER_MISMATCH: 'Purchase Invoice bukan milik pemasok yang dipilih',
} as const;

// Goods Receipt tidak memposting jurnal dan tidak punya nilai uang. Write dibuka untuk admin + accountant.
export const goodsReceiptRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/goods-receipts', {
    schema: {
      tags: ['GoodsReceipt'],
      operationId: 'listGoodsReceipts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: GoodsReceiptListQuerySchema,
      response: { 200: createPaginatedResponseSchema(GoodsReceiptResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listGoodsReceipts(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/goods-receipts/:goodsReceiptId', {
    schema: {
      tags: ['GoodsReceipt'],
      operationId: 'getGoodsReceipt',
      security: [{ bearerAuth: [] }],
      params: GoodsReceiptParamsSchema,
      response: { 200: GoodsReceiptSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getGoodsReceiptById(req.params.businessId, req.params.goodsReceiptId);
      if (!row) return sendError(res, 404, 'NotFound', 'Penerimaan barang tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/goods-receipts', {
    schema: {
      tags: ['GoodsReceipt'],
      operationId: 'createGoodsReceipt',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: GoodsReceiptCreateSchema,
      response: { 201: GoodsReceiptSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createGoodsReceipt(req.params.businessId, req.body);
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/goods-receipts/:goodsReceiptId', {
    schema: {
      tags: ['GoodsReceipt'],
      operationId: 'updateGoodsReceipt',
      security: [{ bearerAuth: [] }],
      params: GoodsReceiptParamsSchema,
      body: GoodsReceiptUpdateSchema,
      response: { 200: GoodsReceiptSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateGoodsReceipt(req.params.businessId, req.params.goodsReceiptId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Penerimaan barang tidak ditemukan');
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/goods-receipts/:goodsReceiptId', {
    schema: {
      tags: ['GoodsReceipt'],
      operationId: 'deleteGoodsReceipt',
      security: [{ bearerAuth: [] }],
      params: GoodsReceiptParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteGoodsReceipt(req.params.businessId, req.params.goodsReceiptId);
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Penerimaan barang tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};