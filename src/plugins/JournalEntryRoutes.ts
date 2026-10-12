import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntryById,
  listJournalEntries,
} from '../repositories/JournalEntryRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import { periodLockedMessage } from '../libs/period-lock.js';
import {
  JournalEntryCreateSchema,
  JournalEntryListQuerySchema,
  JournalEntryParamsSchema,
  JournalEntryResponseSchema,
  JournalEntrySingleResponseSchema,
} from '../schemas/JournalEntry.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

// §4.2: Admin/Akuntan membuat dan menghapus; role lain hanya membaca.
// Tidak ada PUT: jurnal permanen, koreksi lewat Clone lalu hapus (jurnal pembalik).
export const journalEntryRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const readGuards = [fastify.requireAuth, fastify.requireBusinessScope];
  const writeGuards = [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin', 'accountant')];

  app.get('/:businessId/journal-entries', {
    schema: {
      tags: ['JournalEntry'],
      operationId: 'listJournalEntries',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: JournalEntryListQuerySchema,
      response: { 200: createPaginatedResponseSchema(JournalEntryResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: readGuards,
    handler: async (req, res) => {
      const { page, pageSize, search } = req.query;
      const { data, total } = await listJournalEntries(req.params.businessId, page, pageSize, search);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/journal-entries/:journalEntryId', {
    schema: {
      tags: ['JournalEntry'],
      operationId: 'getJournalEntry',
      security: [{ bearerAuth: [] }],
      params: JournalEntryParamsSchema,
      response: { 200: JournalEntrySingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: readGuards,
    handler: async (req, res) => {
      const row = await getJournalEntryById(req.params.businessId, req.params.journalEntryId);
      if (!row) return sendError(res, 404, 'NotFound', 'Jurnal tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/journal-entries', {
    schema: {
      tags: ['JournalEntry'],
      operationId: 'createJournalEntry',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: JournalEntryCreateSchema,
      response: { 201: JournalEntrySingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const outcome = await createJournalEntry(req.params.businessId, req.body);
      if (outcome.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(outcome.lockedUntil, 'create'));
      }
      const { result, error } = outcome;
      if (error === 'INVALID_LINE_AMOUNT') {
        return sendError(res, 400, 'BadRequest', 'Setiap baris harus berisi Debit saja atau Credit saja, dengan nilai lebih dari 0');
      }
      if (error === 'UNBALANCED') return sendError(res, 400, 'BadRequest', 'Total Debit harus sama dengan Total Credit');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun tidak valid atau tidak aktif di bisnis ini');
      return sendData(res, result, 201);
    },
  });

  app.delete('/:businessId/journal-entries/:journalEntryId', {
    schema: {
      tags: ['JournalEntry'],
      operationId: 'deleteJournalEntry',
      security: [{ bearerAuth: [] }],
      params: JournalEntryParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteJournalEntry(req.params.businessId, req.params.journalEntryId);
      if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Jurnal tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};