import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listPurchaseQuotes,
  getPurchaseQuoteById,
  createPurchaseQuote,
  updatePurchaseQuote,
  deletePurchaseQuote,
} from '../repositories/PurchaseQuoteRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  PurchaseQuoteCreateSchema,
  PurchaseQuoteUpdateSchema,
  PurchaseQuoteListQuerySchema,
  PurchaseQuoteResponseSchema,
  PurchaseQuoteSingleResponseSchema,
  PurchaseQuoteParamsSchema,
} from '../schemas/PurchaseQuote.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

const SUPPLIER_ERROR = 'Supplier tidak valid, tidak aktif, atau bukan supplier di bisnis ini';
const NOT_EDITABLE_ERROR = 'Penawaran pembelian yang sudah dibatalkan tidak dapat diubah';

// Purchase Quote tidak memposting jurnal. Write dibuka untuk admin + accountant.
export const purchaseQuoteRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/purchase-quotes', {
    schema: {
      tags: ['PurchaseQuote'],
      operationId: 'listPurchaseQuotes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PurchaseQuoteListQuerySchema,
      response: { 200: createPaginatedResponseSchema(PurchaseQuoteResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, status, supplierId, dateFrom, dateTo } = req.query;
      const { data, total } = await listPurchaseQuotes(req.params.businessId, page, pageSize, {
        search,
        status,
        supplierId,
        dateFrom,
        dateTo,
      });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/purchase-quotes/:purchaseQuoteId', {
    schema: {
      tags: ['PurchaseQuote'],
      operationId: 'getPurchaseQuote',
      security: [{ bearerAuth: [] }],
      params: PurchaseQuoteParamsSchema,
      response: { 200: PurchaseQuoteSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getPurchaseQuoteById(req.params.businessId, req.params.purchaseQuoteId);
      if (!row) return sendError(res, 404, 'NotFound', 'Penawaran pembelian tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/purchase-quotes', {
    schema: {
      tags: ['PurchaseQuote'],
      operationId: 'createPurchaseQuote',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: PurchaseQuoteCreateSchema,
      response: { 201: PurchaseQuoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createPurchaseQuote(req.params.businessId, req.body);
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', SUPPLIER_ERROR);
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/purchase-quotes/:purchaseQuoteId', {
    schema: {
      tags: ['PurchaseQuote'],
      operationId: 'updatePurchaseQuote',
      security: [{ bearerAuth: [] }],
      params: PurchaseQuoteParamsSchema,
      body: PurchaseQuoteUpdateSchema,
      response: { 200: PurchaseQuoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updatePurchaseQuote(
        req.params.businessId,
        req.params.purchaseQuoteId,
        req.body,
      );
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Penawaran pembelian tidak ditemukan');
      if (error === 'NOT_EDITABLE') return sendError(res, 400, 'BadRequest', NOT_EDITABLE_ERROR);
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', SUPPLIER_ERROR);
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/purchase-quotes/:purchaseQuoteId', {
    schema: {
      tags: ['PurchaseQuote'],
      operationId: 'deletePurchaseQuote',
      security: [{ bearerAuth: [] }],
      params: PurchaseQuoteParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deletePurchaseQuote(req.params.businessId, req.params.purchaseQuoteId);
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Penawaran pembelian tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};