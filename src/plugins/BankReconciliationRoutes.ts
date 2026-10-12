import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createBankReconciliation,
  deleteBankReconciliation,
  getBankReconciliationById,
  listBankReconciliations,
  updateBankReconciliation,
} from '../repositories/BankReconciliationRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  BankReconciliationCreateSchema,
  BankReconciliationParamsSchema,
  BankReconciliationResponseSchema,
  BankReconciliationSingleResponseSchema,
  BankReconciliationUpdateSchema,
} from '../schemas/BankReconciliation.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';

// §11.2: Admin menyetujui, Staf Finance memeriksa - WRITE untuk admin + accountant.
export const bankReconciliationRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const readGuards = [fastify.requireAuth, fastify.requireBusinessScope];
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/bank-reconciliations', {
    schema: {
      tags: ['BankReconciliation'],
      operationId: 'listBankReconciliations',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(BankReconciliationResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: readGuards,
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listBankReconciliations(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/bank-reconciliations/:reconciliationId', {
    schema: {
      tags: ['BankReconciliation'],
      operationId: 'getBankReconciliation',
      security: [{ bearerAuth: [] }],
      params: BankReconciliationParamsSchema,
      response: { 200: BankReconciliationSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: readGuards,
    handler: async (req, res) => {
      const row = await getBankReconciliationById(req.params.businessId, req.params.reconciliationId);
      if (!row) return sendError(res, 404, 'NotFound', 'Rekonsiliasi bank tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/bank-reconciliations', {
    schema: {
      tags: ['BankReconciliation'],
      operationId: 'createBankReconciliation',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: BankReconciliationCreateSchema,
      response: { 201: BankReconciliationSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createBankReconciliation(req.params.businessId, req.body);
      if (error === 'INVALID_BANK_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun bank/kas tidak valid di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.put('/:businessId/bank-reconciliations/:reconciliationId', {
    schema: {
      tags: ['BankReconciliation'],
      operationId: 'updateBankReconciliation',
      security: [{ bearerAuth: [] }],
      params: BankReconciliationParamsSchema,
      body: BankReconciliationUpdateSchema,
      response: { 200: BankReconciliationSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const row = await updateBankReconciliation(req.params.businessId, req.params.reconciliationId, req.body);
      if (!row) return sendError(res, 404, 'NotFound', 'Rekonsiliasi bank tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/bank-reconciliations/:reconciliationId', {
    schema: {
      tags: ['BankReconciliation'],
      operationId: 'deleteBankReconciliation',
      security: [{ bearerAuth: [] }],
      params: BankReconciliationParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const deleted = await deleteBankReconciliation(req.params.businessId, req.params.reconciliationId);
      if (!deleted) return sendError(res, 404, 'NotFound', 'Rekonsiliasi bank tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};