import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listDebitNotes,
  getDebitNoteById,
  createDebitNote,
  deleteDebitNote,
} from '../repositories/DebitNoteRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  DebitNoteCreateSchema,
  DebitNoteListQuerySchema,
  DebitNoteResponseSchema,
  DebitNoteSingleResponseSchema,
  DebitNoteParamsSchema,
} from '../schemas/DebitNote.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';
import { periodLockedMessage } from '../libs/period-lock.js';

// Debit Note memposting jurnal saat dibuat dan tidak bisa diedit (koreksi: Clone lalu hapus).
// Bila dikaitkan ke faktur, sisa tagihan faktur itu berkurang. Write dibuka untuk admin + accountant.
export const debitNoteRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/debit-notes', {
    schema: {
      tags: ['DebitNote'],
      operationId: 'listDebitNotes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: DebitNoteListQuerySchema,
      response: { 200: createPaginatedResponseSchema(DebitNoteResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listDebitNotes(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/debit-notes/:debitNoteId', {
    schema: {
      tags: ['DebitNote'],
      operationId: 'getDebitNote',
      security: [{ bearerAuth: [] }],
      params: DebitNoteParamsSchema,
      response: { 200: DebitNoteSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getDebitNoteById(req.params.businessId, req.params.debitNoteId);
      if (!row) return sendError(res, 404, 'NotFound', 'Debit Note tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/debit-notes', {
    schema: {
      tags: ['DebitNote'],
      operationId: 'createDebitNote',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: DebitNoteCreateSchema,
      response: { 201: DebitNoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const out = await createDebitNote(req.params.businessId, req.body);
      if (out.error === 'PERIOD_LOCKED') {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(out.lockedUntil, 'create'));
      }
      const { result, error } = out;
      if (error === 'INVALID_SUPPLIER') return sendError(res, 400, 'BadRequest', 'Supplier tidak valid, tidak aktif, atau bukan supplier di bisnis ini');
      if (error === 'INVALID_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Semua akun rincian harus bertipe Expense di bisnis ini');
      if (error === 'ZERO_TOTAL') return sendError(res, 400, 'BadRequest', 'Total Debit Note harus lebih dari 0');
      if (error === 'INVALID_INVOICE') return sendError(res, 400, 'BadRequest', 'Faktur pembelian tidak ditemukan atau belum berstatus approved');
      if (error === 'INVOICE_SUPPLIER_MISMATCH') return sendError(res, 400, 'BadRequest', 'Supplier Debit Note harus sama dengan supplier faktur yang dikaitkan');
      if (error === 'OVER_BALANCE') return sendError(res, 400, 'BadRequest', 'Total Debit Note melebihi sisa tagihan faktur yang dikaitkan');
      if (error === 'NO_AP_ACCOUNT') return sendError(res, 400, 'BadRequest', 'Akun Utang Usaha (kode 2000) tidak ditemukan di Chart of Accounts');
      return sendData(res, result, 201);
    },
  });

  app.delete('/:businessId/debit-notes/:debitNoteId', {
    schema: {
      tags: ['DebitNote'],
      operationId: 'deleteDebitNote',
      security: [{ bearerAuth: [] }],
      params: DebitNoteParamsSchema,
      response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteDebitNote(req.params.businessId, req.params.debitNoteId);
      if (result.lockedUntil) {
        return sendError(res, 400, 'BadRequest', periodLockedMessage(result.lockedUntil, 'delete'));
      }

      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Debit Note tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};