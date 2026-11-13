import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listWithholdingTaxReceipts,
  getWithholdingTaxReceiptById,
  createWithholdingTaxReceipt,
  updateWithholdingTaxReceipt,
  deleteWithholdingTaxReceipt,
} from '../repositories/WithholdingTaxReceiptRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import { periodLockedMessage } from '../libs/period-lock.js';
import {
  WithholdingTaxReceiptCreateSchema,
  WithholdingTaxReceiptUpdateSchema,
  WithholdingTaxReceiptListQuerySchema,
  WithholdingTaxReceiptResponseSchema,
  WithholdingTaxReceiptSingleResponseSchema,
  WithholdingTaxReceiptParamsSchema,
} from '../schemas/WithholdingTaxReceipt.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CUSTOMER: 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini',
};

// Withholding Tax Receipt memposting jurnal. Write dibuka untuk admin + accountant.
export const withholdingTaxReceiptRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/withholding-tax-receipts', {
    schema: {
      tags: ['WithholdingTaxReceipt'],
      operationId: 'listWithholdingTaxReceipts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: WithholdingTaxReceiptListQuerySchema,
      response: {
        200: createPaginatedResponseSchema(WithholdingTaxReceiptResponseSchema),
        401: Unauthorized,
        404: NotFound,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, customerId, dateFrom, dateTo } = req.query;
      const { data, total } = await listWithholdingTaxReceipts(req.params.businessId, page, pageSize, {
        search,
        customerId,
        dateFrom,
        dateTo,
      });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/withholding-tax-receipts/:withholdingTaxReceiptId', {
    schema: {
      tags: ['WithholdingTaxReceipt'],
      operationId: 'getWithholdingTaxReceipt',
      security: [{ bearerAuth: [] }],
      params: WithholdingTaxReceiptParamsSchema,
      response: { 200: WithholdingTaxReceiptSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getWithholdingTaxReceiptById(req.params.businessId, req.params.withholdingTaxReceiptId);
      if (!row) return sendError(res, 404, 'NotFound', 'Withholding Tax Receipt tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/withholding-tax-receipts', {
    schema: {
      tags: ['WithholdingTaxReceipt'],
      operationId: 'createWithholdingTaxReceipt',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: WithholdingTaxReceiptCreateSchema,
      response: {
        201: WithholdingTaxReceiptSingleResponseSchema,
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
      },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error, lockedUntil } = await createWithholdingTaxReceipt(req.params.businessId, req.body);
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'create'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/withholding-tax-receipts/:withholdingTaxReceiptId', {
    schema: {
      tags: ['WithholdingTaxReceipt'],
      operationId: 'updateWithholdingTaxReceipt',
      security: [{ bearerAuth: [] }],
      params: WithholdingTaxReceiptParamsSchema,
      body: WithholdingTaxReceiptUpdateSchema,
      response: {
        200: WithholdingTaxReceiptSingleResponseSchema,
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
      },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error, lockedUntil } = await updateWithholdingTaxReceipt(
        req.params.businessId,
        req.params.withholdingTaxReceiptId,
        req.body,
      );
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Withholding Tax Receipt tidak ditemukan');
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'create'));
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/withholding-tax-receipts/:withholdingTaxReceiptId', {
    schema: {
      tags: ['WithholdingTaxReceipt'],
      operationId: 'deleteWithholdingTaxReceipt',
      security: [{ bearerAuth: [] }],
      params: WithholdingTaxReceiptParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { deleted, error, lockedUntil } = await deleteWithholdingTaxReceipt(
        req.params.businessId,
        req.params.withholdingTaxReceiptId,
      );
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Withholding Tax Receipt tidak ditemukan');
      if (error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(lockedUntil!, 'delete'));
      if (!deleted) return sendError(res, 404, 'NotFound', 'Withholding Tax Receipt tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};