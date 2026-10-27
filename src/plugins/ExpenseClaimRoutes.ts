import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listExpenseClaims,
  getExpenseClaimById,
  createExpenseClaim,
  deleteExpenseClaim,
} from '../repositories/ExpenseClaimRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import { periodLockedMessage } from '../libs/period-lock.js';
import {
  ExpenseClaimCreateSchema,
  ExpenseClaimListQuerySchema,
  ExpenseClaimListResponseSchema,
  ExpenseClaimSingleResponseSchema,
  ExpenseClaimParamsSchema,
} from '../schemas/ExpenseClaim.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest } from '../schemas/globals.js';

// READ semua role, WRITE admin + accountant.
export const expenseClaimRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/expense-claims', {
    schema: {
      tags: ['ExpenseClaim'],
      operationId: 'listExpenseClaims',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: ExpenseClaimListQuerySchema,
      response: { 200: ExpenseClaimListResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, payerId, dateFrom, dateTo } = req.query;
      const { data, total } = await listExpenseClaims(req.params.businessId, page, pageSize, {
        search,
        payerId,
        dateFrom,
        dateTo,
      });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/expense-claims', {
    schema: {
      tags: ['ExpenseClaim'],
      operationId: 'createExpenseClaim',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: ExpenseClaimCreateSchema,
      response: { 201: ExpenseClaimSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await createExpenseClaim(req.params.businessId, req.body);
      if (out.error === 'INVALID_PAYER') return sendError(res, 400, 'BadRequest', 'Payer tidak valid di bisnis ini');
      if (out.error === 'INACTIVE_PAYER') return sendError(res, 400, 'BadRequest', 'Payer berstatus Inactive, aktifkan dulu atau pilih Payer lain');
      if (out.error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun baris harus akun Beban/Aset yang aktif di bisnis ini dan bukan akun bank/kas');
      if (out.error === 'INVALID_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek pada baris tidak valid di bisnis ini');
      if (out.error === 'INACTIVE_PROJECT') return sendError(res, 400, 'BadRequest', 'Proyek berstatus Inactive atau Completed, pilih proyek yang Active');
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'create'));
      return sendData(res, out.result, 201);
    },
  });

  app.get('/:businessId/expense-claims/:claimId', {
    schema: {
      tags: ['ExpenseClaim'],
      operationId: 'getExpenseClaim',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimParamsSchema,
      response: { 200: ExpenseClaimSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getExpenseClaimById(req.params.businessId, req.params.claimId);
      if (!row) return sendError(res, 404, 'NotFound', 'Klaim biaya tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/expense-claims/:claimId', {
    schema: {
      tags: ['ExpenseClaim'],
      operationId: 'deleteExpenseClaim',
      security: [{ bearerAuth: [] }],
      params: ExpenseClaimParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await deleteExpenseClaim(req.params.businessId, req.params.claimId);
      if (out.error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Klaim biaya tidak ditemukan');
      if (out.error === 'PERIOD_LOCKED') return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'void'));
      if (out.error === 'HAS_PAYMENTS') return sendError(res, 409, 'Conflict', 'Klaim ini sudah punya pembayaran. Hapus pembayarannya terlebih dahulu');
      return res.code(204).send(null);
    },
  });
};