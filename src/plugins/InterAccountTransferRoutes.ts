import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listTransfers,
  getTransferById,
  createTransfer,
  setTransferCleared,
  deleteTransfer,
} from '../repositories/InterAccountTransferRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  InterAccountTransferCreateSchema,
  InterAccountTransferListResponseSchema,
  InterAccountTransferSingleResponseSchema,
  InterAccountTransferParamsSchema,
  InterAccountTransferListQuerySchema,
  SetTransferClearedSchema,
} from '../schemas/InterAccountTransfer.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// §4.2: Staf Keuangan melakukan transfer - WRITE untuk admin + accountant,
// sama seperti Receipts dan Payments.
export const interAccountTransferRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/inter-account-transfers', {
    schema: {
      tags: ['InterAccountTransfer'],
      operationId: 'listInterAccountTransfers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: InterAccountTransferListQuerySchema,
      response: { 200: InterAccountTransferListResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listTransfers(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/inter-account-transfers', {
    schema: {
      tags: ['InterAccountTransfer'],
      operationId: 'createInterAccountTransfer',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: InterAccountTransferCreateSchema,
      response: {
        201: InterAccountTransferSingleResponseSchema,
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
      },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const outcome = await createTransfer(req.params.businessId, req.body);
      if (outcome.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(outcome.lockedUntil, 'create'));
      }
      const { result, error } = outcome;
      if (error === 'SAME_ACCOUNT') {
        return sendError(res, 400, 'BadRequest', 'Akun asal dan akun tujuan harus berbeda');
      }
      if (error === 'INVALID_BANK_ACCOUNT') {
        return sendError(res, 400, 'BadRequest', 'Akun bank/kas asal atau tujuan tidak valid di bisnis ini');
      }
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/inter-account-transfers/:transferId', {
    schema: {
      tags: ['InterAccountTransfer'],
      operationId: 'getInterAccountTransfer',
      security: [{ bearerAuth: [] }],
      params: InterAccountTransferParamsSchema,
      response: { 200: InterAccountTransferSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getTransferById(req.params.businessId, req.params.transferId);
      if (!row) return sendError(res, 404, 'NotFound', 'Transfer tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/inter-account-transfers/:transferId/cleared', {
    schema: {
      tags: ['InterAccountTransfer'],
      operationId: 'setInterAccountTransferCleared',
      security: [{ bearerAuth: [] }],
      params: InterAccountTransferParamsSchema,
      body: SetTransferClearedSchema,
      response: { 200: InterAccountTransferSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const row = await setTransferCleared(req.params.businessId, req.params.transferId, req.body);
      if (!row) return sendError(res, 404, 'NotFound', 'Transfer tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/inter-account-transfers/:transferId', {
    schema: {
      tags: ['InterAccountTransfer'],
      operationId: 'deleteInterAccountTransfer',
      security: [{ bearerAuth: [] }],
      params: InterAccountTransferParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteTransfer(req.params.businessId, req.params.transferId);
            if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Transfer tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};