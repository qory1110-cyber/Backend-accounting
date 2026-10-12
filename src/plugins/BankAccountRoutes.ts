import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listBankAccounts,
  getBankAccountById,
  createBankAccount,
  updateBankAccount,
  listRecentBankAccounts,
  setBankAccountActive,
  deleteBankAccount,
  findValidControlAccount,
  setBankAccountLockDate,
} from '../repositories/BankAccountRepository.js';
import { isPgUniqueViolation } from '../libs/safe-error.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  BankAccountCreateSchema,
  BankAccountUpdateSchema,
  BankAccountToggleActiveSchema,
  BankAccountResponseSchema,
  RecentBankAccountResponseSchema,
  RecentBankAccountQuerySchema,
  BankAccountListResponseSchema,
  BankAccountSingleResponseSchema,
  BankAccountParamsSchema,
  BankAccountLockDateSchema,
} from '../schemas/BankAccount.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';

export const bankAccountRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:businessId/bank-accounts', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'listBankAccounts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(BankAccountResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listBankAccounts(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/bank-accounts', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'createBankAccount',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: BankAccountCreateSchema,
      response: {
        201: BankAccountSingleResponseSchema,
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      // §4.4 aturan #1: Control Account wajib ada, milik bisnis ini, dan tipe Asset.
      const validAccount = await findValidControlAccount(req.params.businessId, req.body.controlAccountId);
      if (!validAccount) {
        return sendError(res, 400, 'BadRequest', 'Control Account tidak valid atau bukan tipe Asset');
      }

      try {
        const row = await createBankAccount(req.params.businessId, req.body);
        return sendData(res, row, 201);
      } catch (err) {
        // §4.4 aturan #2: 1 Control Account cuma boleh dipakai 1 akun bank
        // (ditegakkan lewat .unique() di kolom controlAccountId).
        if (isPgUniqueViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Control Account ini sudah dipakai akun bank/kas lain');
        }
        throw err;
      }
    },
  });

  app.get('/:businessId/bank-accounts/recent', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'listRecentBankAccounts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: RecentBankAccountQuerySchema,
      response: { 200: RecentBankAccountResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await listRecentBankAccounts(req.params.businessId, req.query.limit)),
  });

  app.get('/:businessId/bank-accounts/:bankAccountId', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'getBankAccount',
      security: [{ bearerAuth: [] }],
      params: BankAccountParamsSchema,
      response: { 200: BankAccountSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getBankAccountById(req.params.businessId, req.params.bankAccountId);
      if (!row) return sendError(res, 404, 'NotFound', 'Akun bank/kas tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/bank-accounts/:bankAccountId', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'updateBankAccount',
      security: [{ bearerAuth: [] }],
      params: BankAccountParamsSchema,
      body: BankAccountUpdateSchema,
      response: {
        200: BankAccountSingleResponseSchema,
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      if (req.body.controlAccountId) {
        const validAccount = await findValidControlAccount(req.params.businessId, req.body.controlAccountId);
        if (!validAccount) {
          return sendError(res, 400, 'BadRequest', 'Control Account tidak valid atau bukan tipe Asset');
        }
      }
      try {
        const row = await updateBankAccount(req.params.businessId, req.params.bankAccountId, req.body);
        if (!row) return sendError(res, 404, 'NotFound', 'Akun bank/kas tidak ditemukan');
        return sendData(res, row);
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Control Account ini sudah dipakai akun bank/kas lain');
        }
        throw err;
      }
    },
  });

  app.patch('/:businessId/bank-accounts/:bankAccountId/active', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'setBankAccountActive',
      security: [{ bearerAuth: [] }],
      params: BankAccountParamsSchema,
      body: BankAccountToggleActiveSchema,
      response: { 200: BankAccountSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await setBankAccountActive(req.params.businessId, req.params.bankAccountId, req.body.isActive);
      if (!row) return sendError(res, 404, 'NotFound', 'Akun bank/kas tidak ditemukan');
      return sendData(res, row);
    },
  });

    app.patch('/:businessId/bank-accounts/:bankAccountId/lock-date', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'setBankAccountLockDate',
      security: [{ bearerAuth: [] }],
      params: BankAccountParamsSchema,
      body: BankAccountLockDateSchema,
      response: { 200: BankAccountSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await setBankAccountLockDate(req.params.businessId, req.params.bankAccountId, req.body.lockDate);
      if (!row) return sendError(res, 404, 'NotFound', 'Akun bank/kas tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/bank-accounts/:bankAccountId', {
    schema: {
      tags: ['BankAccount'],
      operationId: 'deleteBankAccount',
      security: [{ bearerAuth: [] }],
      params: BankAccountParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const result = await deleteBankAccount(req.params.businessId, req.params.bankAccountId);
      if (result.hasTransactions) {
        return sendError(res, 409, 'Conflict', 'Akun ini sudah punya transaksi, gunakan status Inactive alih-alih menghapus');
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Akun bank/kas tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};