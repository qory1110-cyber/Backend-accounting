import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  listChartOfAccounts,
  listRecentChartOfAccounts,
  getChartOfAccountById,
  createChartOfAccount,
  updateChartOfAccount,
  setChartOfAccountActive,
} from '../repositories/ChartOfAccountRepository.js';
import { isPgUniqueViolation } from '../libs/safe-error.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  ChartOfAccountCreateSchema,
  ChartOfAccountUpdateSchema,
  ChartOfAccountListQuerySchema,
  ChartOfAccountResponseSchema,
  RecentChartOfAccountResponseSchema,
  RecentChartOfAccountQuerySchema,
  ChartOfAccountListResponseSchema,
  ChartOfAccountSingleResponseSchema,
  ChartOfAccountParamsSchema,
  ChartOfAccountToggleActiveSchema,
} from '../schemas/ChartOfAccount.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';
import { deleteChartOfAccount } from '../repositories/ChartOfAccountRepository.js';
import { isPgForeignKeyViolation } from '../libs/safe-error.js';
import { z } from 'zod';

// Sesuai §2.3 dokumen analisis: Chart of Accounts itu item SETTINGS
// (dikonfigurasi sekali, jarang berubah) - bukan modul transaksi harian.
// Karena itu: CREATE/UPDATE/DELETE dibatasi admin saja, tapi READ boleh
// semua role (accountant/viewer perlu lihat daftar akun untuk referensi,
// meskipun modul yang benar-benar memakainya - jurnal, dst - baru fase berikutnya).
export const chartOfAccountRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:businessId/chart-of-accounts', {
    schema: {
      tags: ['ChartOfAccount'],
      operationId: 'listChartOfAccounts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: ChartOfAccountListQuerySchema.and(PaginationQuerySchema),
      response: { 200: createPaginatedResponseSchema(ChartOfAccountResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, category } = req.query;
      const { data, total } = await listChartOfAccounts(req.params.businessId, page, pageSize, category);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/chart-of-accounts', {
    schema: {
      tags: ['ChartOfAccount'],
      operationId: 'createChartOfAccount',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: ChartOfAccountCreateSchema,
      response: {
        201: ChartOfAccountSingleResponseSchema,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      try {
        const row = await createChartOfAccount(req.params.businessId, req.body);
        return sendData(res, row, 201);
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Kode akun ini sudah dipakai di bisnis ini');
        }
        throw err;
      }
    },
  });

  app.get('/:businessId/chart-of-accounts/recent', {
    schema: {
      tags: ['ChartOfAccount'],
      operationId: 'listRecentChartOfAccounts',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: RecentChartOfAccountQuerySchema,
      response: { 200: RecentChartOfAccountResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { limit, category } = req.query;
      return sendData(res, await listRecentChartOfAccounts(req.params.businessId, limit, category));
    },
  });

  app.get('/:businessId/chart-of-accounts/:accountId', {
    schema: {
      tags: ['ChartOfAccount'],
      operationId: 'getChartOfAccount',
      security: [{ bearerAuth: [] }],
      params: ChartOfAccountParamsSchema,
      response: { 200: ChartOfAccountSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getChartOfAccountById(req.params.businessId, req.params.accountId);
      if (!row) return sendError(res, 404, 'NotFound', 'Akun tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/chart-of-accounts/:accountId', {
    schema: {
      tags: ['ChartOfAccount'],
      operationId: 'updateChartOfAccount',
      security: [{ bearerAuth: [] }],
      params: ChartOfAccountParamsSchema,
      body: ChartOfAccountUpdateSchema,
      response: {
        200: ChartOfAccountSingleResponseSchema,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      try {
        const row = await updateChartOfAccount(req.params.businessId, req.params.accountId, req.body);
        if (!row) return sendError(res, 404, 'NotFound', 'Akun tidak ditemukan');
        return sendData(res, row);
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Kode akun ini sudah dipakai di bisnis ini');
        }
        throw err;
      }
    },
  });

  app.patch('/:businessId/chart-of-accounts/:accountId/active', {
  schema: {
    tags: ['ChartOfAccount'],
    operationId: 'setChartOfAccountActive',
    security: [{ bearerAuth: [] }],
    params: ChartOfAccountParamsSchema,
    body: ChartOfAccountToggleActiveSchema,
    response: {
      200: ChartOfAccountSingleResponseSchema,
      401: Unauthorized,
      403: Forbidden,
      404: NotFound,
    },
  },
  preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
  handler: async (req, res) => {
    const row = await setChartOfAccountActive(req.params.businessId, req.params.accountId, req.body.isActive);
    if (!row) return sendError(res, 404, 'NotFound', 'Akun tidak ditemukan');
    return sendData(res, row);
  },
});

app.delete('/:businessId/chart-of-accounts/:accountId', {
  schema: {
    tags: ['ChartOfAccount'],
    operationId: 'deleteChartOfAccount',
    security: [{ bearerAuth: [] }],
    params: ChartOfAccountParamsSchema,
    response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
  },
  preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
  handler: async (req, res) => {
    try {
      const deleted = await deleteChartOfAccount(req.params.businessId, req.params.accountId);
      if (!deleted) return sendError(res, 404, 'NotFound', 'Akun tidak ditemukan');
      return res.code(204).send(null);
    } catch (err) {
      if (isPgForeignKeyViolation(err)) {
        return sendError(res, 409, 'Conflict', 'Akun ini sudah punya riwayat transaksi, gunakan status Inactive alih-alih menghapus');
      }
      throw err;
    }
  },
});
};