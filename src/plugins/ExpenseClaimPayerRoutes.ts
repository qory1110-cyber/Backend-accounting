import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listPayers,
  getPayerById,
  createPayer,
  updatePayer,
  setPayerActive,
  deletePayer,
} from '../repositories/ExpenseClaimPayerRepository.js';
import { isPgForeignKeyViolation } from '../libs/safe-error.js';
import { sendData, sendError } from '../libs/reply.js';
import {
  ExpenseClaimPayerCreateSchema,
  ExpenseClaimPayerUpdateSchema,
  ExpenseClaimPayerToggleActiveSchema,
  ExpenseClaimPayerListResponseSchema,
  ExpenseClaimPayerSingleResponseSchema,
  ExpenseClaimPayerParamsSchema,
} from '../schemas/ExpenseClaimPayer.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict } from '../schemas/globals.js';

// READ semua role, WRITE admin + accountant.
export const expenseClaimPayerRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:businessId/expense-claim-payers', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'listExpenseClaimPayers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: ExpenseClaimPayerListResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await listPayers(req.params.businessId)),
  });

  app.post('/:businessId/expense-claim-payers', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'createExpenseClaimPayer',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: ExpenseClaimPayerCreateSchema,
      response: { 201: ExpenseClaimPayerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')],
    handler: async (req, res) => {
      const { result, error } = await createPayer(req.params.businessId, req.body);
      if (error === 'DUPLICATE_NAME') return sendError(res, 409, 'Conflict', 'Nama Payer sudah dipakai');
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/expense-claim-payers/:payerId', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'getExpenseClaimPayer',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimPayerParamsSchema,
      response: { 200: ExpenseClaimPayerSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getPayerById(req.params.businessId, req.params.payerId);
      if (!row) return sendError(res, 404, 'NotFound', 'Payer tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/expense-claim-payers/:payerId', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'updateExpenseClaimPayer',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimPayerParamsSchema,
      body: ExpenseClaimPayerUpdateSchema,
      response: { 200: ExpenseClaimPayerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')],
    handler: async (req, res) => {
      const { result, error } = await updatePayer(req.params.businessId, req.params.payerId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Payer tidak ditemukan');
      if (error === 'DUPLICATE_NAME') return sendError(res, 409, 'Conflict', 'Nama Payer sudah dipakai');
      return sendData(res, result);
    },
  });

  app.patch('/:businessId/expense-claim-payers/:payerId/active', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'setExpenseClaimPayerActive',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimPayerParamsSchema,
      body: ExpenseClaimPayerToggleActiveSchema,
      response: { 200: ExpenseClaimPayerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')],
    handler: async (req, res) => {
      const row = await setPayerActive(req.params.businessId, req.params.payerId, req.body.isActive);
      if (!row) return sendError(res, 404, 'NotFound', 'Payer tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/expense-claim-payers/:payerId', {
    schema: {
      tags: ['ExpenseClaimPayer'],
      operationId: 'deleteExpenseClaimPayer',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimPayerParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')],
    handler: async (req, res) => {
      try {
        const deleted = await deletePayer(req.params.businessId, req.params.payerId);
        if (!deleted) return sendError(res, 404, 'NotFound', 'Payer tidak ditemukan');
        return res.code(204).send(null);
      } catch (err) {
        if (isPgForeignKeyViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Payer ini sudah punya riwayat transaksi, gunakan status Inactive alih-alih menghapus');
        }
        throw err;
      }
    },
  });
};