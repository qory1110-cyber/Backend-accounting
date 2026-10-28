import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listSalesQuotes,
  getSalesQuoteById,
  createSalesQuote,
  updateSalesQuote,
  deleteSalesQuote,
} from '../repositories/SalesQuoteRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  SalesQuoteCreateSchema,
  SalesQuoteUpdateSchema,
  SalesQuoteListQuerySchema,
  SalesQuoteResponseSchema,
  SalesQuoteSingleResponseSchema,
  SalesQuoteParamsSchema,
} from '../schemas/SalesQuote.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

// Sales Quote tidak memposting jurnal. Write dibuka untuk admin + accountant.
export const salesQuoteRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/sales-quotes', {
    schema: {
      tags: ['SalesQuote'],
      operationId: 'listSalesQuotes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: SalesQuoteListQuerySchema,
      response: { 200: createPaginatedResponseSchema(SalesQuoteResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listSalesQuotes(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/sales-quotes/:salesQuoteId', {
    schema: {
      tags: ['SalesQuote'],
      operationId: 'getSalesQuote',
      security: [{ bearerAuth: [] }],
      params: SalesQuoteParamsSchema,
      response: { 200: SalesQuoteSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getSalesQuoteById(req.params.businessId, req.params.salesQuoteId);
      if (!row) return sendError(res, 404, 'NotFound', 'Penawaran penjualan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/sales-quotes', {
    schema: {
      tags: ['SalesQuote'],
      operationId: 'createSalesQuote',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: SalesQuoteCreateSchema,
      response: { 201: SalesQuoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createSalesQuote(req.params.businessId, req.body);
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/sales-quotes/:salesQuoteId', {
    schema: {
      tags: ['SalesQuote'],
      operationId: 'updateSalesQuote',
      security: [{ bearerAuth: [] }],
      params: SalesQuoteParamsSchema,
      body: SalesQuoteUpdateSchema,
      response: { 200: SalesQuoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateSalesQuote(req.params.businessId, req.params.salesQuoteId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Penawaran penjualan tidak ditemukan');
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/sales-quotes/:salesQuoteId', {
    schema: {
      tags: ['SalesQuote'],
      operationId: 'deleteSalesQuote',
      security: [{ bearerAuth: [] }],
      params: SalesQuoteParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteSalesQuote(req.params.businessId, req.params.salesQuoteId);
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Penawaran penjualan tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};