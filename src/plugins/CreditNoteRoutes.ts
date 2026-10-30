import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listCreditNotes,
  getCreditNoteById,
  createCreditNote,
  deleteCreditNote,
} from '../repositories/CreditNoteRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  CreditNoteCreateSchema,
  CreditNoteListQuerySchema,
  CreditNoteResponseSchema,
  CreditNoteSingleResponseSchema,
  CreditNoteParamsSchema,
} from '../schemas/CreditNote.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// Credit Note memposting jurnal saat dibuat dan tidak bisa diedit (koreksi: Clone lalu hapus).
// Write dibuka untuk admin + accountant.
export const creditNoteRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/credit-notes', {
    schema: {
      tags: ['CreditNote'],
      operationId: 'listCreditNotes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: CreditNoteListQuerySchema,
      response: { 200: createPaginatedResponseSchema(CreditNoteResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listCreditNotes(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/credit-notes/:creditNoteId', {
    schema: {
      tags: ['CreditNote'],
      operationId: 'getCreditNote',
      security: [{ bearerAuth: [] }],
      params: CreditNoteParamsSchema,
      response: { 200: CreditNoteSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getCreditNoteById(req.params.businessId, req.params.creditNoteId);
      if (!row) return sendError(res, 404, 'NotFound', 'Credit Note tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/credit-notes', {
    schema: {
      tags: ['CreditNote'],
      operationId: 'createCreditNote',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: CreditNoteCreateSchema,
      response: { 201: CreditNoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await createCreditNote(req.params.businessId, req.body);
      if (out.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'create'));
      }
      const { result, error } = out;
      if (error === 'INVALID_CUSTOMER') return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Income di bisnis ini');
      if (error === 'ZERO_TOTAL') return sendError(res, 400, 'BadRequest', 'Total Credit Note harus lebih dari 0');
      if (error === 'NO_AR_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Piutang Usaha (kode 1200) tidak ditemukan di Chart of Accounts');
      return sendData(res, result, 201);
    },
  });

  app.delete('/:businessId/credit-notes/:creditNoteId', {
    schema: {
      tags: ['CreditNote'],
      operationId: 'deleteCreditNote',
      security: [{ bearerAuth: [] }],
      params: CreditNoteParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteCreditNote(req.params.businessId, req.params.creditNoteId);
      if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Credit Note tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};