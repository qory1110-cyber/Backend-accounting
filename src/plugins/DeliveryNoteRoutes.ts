import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listDeliveryNotes,
  getDeliveryNoteById,
  createDeliveryNote,
  updateDeliveryNote,
  deleteDeliveryNote,
} from '../repositories/DeliveryNoteRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  DeliveryNoteCreateSchema,
  DeliveryNoteUpdateSchema,
  DeliveryNoteListQuerySchema,
  DeliveryNoteResponseSchema,
  DeliveryNoteSingleResponseSchema,
  DeliveryNoteParamsSchema,
} from '../schemas/DeliveryNote.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, BadRequest, createPaginatedResponseSchema } from '../schemas/globals.js';

const ERROR_MESSAGES = {
  INVALID_CUSTOMER: 'Pelanggan tidak valid, tidak aktif, atau bukan pelanggan di bisnis ini',
  INVALID_ORDER: 'Sales Order tidak ditemukan di bisnis ini',
  ORDER_CUSTOMER_MISMATCH: 'Sales Order bukan milik pelanggan yang dipilih',
  INVALID_INVOICE: 'Sales Invoice tidak ditemukan di bisnis ini',
  INVOICE_CUSTOMER_MISMATCH: 'Sales Invoice bukan milik pelanggan yang dipilih',
} as const;

// Delivery Note tidak memposting jurnal dan tidak punya nilai uang. Write dibuka untuk admin + accountant.
export const deliveryNoteRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/delivery-notes', {
    schema: {
      tags: ['DeliveryNote'],
      operationId: 'listDeliveryNotes',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: DeliveryNoteListQuerySchema,
      response: { 200: createPaginatedResponseSchema(DeliveryNoteResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, dateFrom, dateTo } = req.query;
      const { data, total } = await listDeliveryNotes(req.params.businessId, page, pageSize, { search, dateFrom, dateTo });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.get('/:businessId/delivery-notes/:deliveryNoteId', {
    schema: {
      tags: ['DeliveryNote'],
      operationId: 'getDeliveryNote',
      security: [{ bearerAuth: [] }],
      params: DeliveryNoteParamsSchema,
      response: { 200: DeliveryNoteSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getDeliveryNoteById(req.params.businessId, req.params.deliveryNoteId);
      if (!row) return sendError(res, 404, 'NotFound', 'Surat jalan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.post('/:businessId/delivery-notes', {
    schema: {
      tags: ['DeliveryNote'],
      operationId: 'createDeliveryNote',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: DeliveryNoteCreateSchema,
      response: { 201: DeliveryNoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createDeliveryNote(req.params.businessId, req.body);
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result, 201);
    },
  });

  app.patch('/:businessId/delivery-notes/:deliveryNoteId', {
    schema: {
      tags: ['DeliveryNote'],
      operationId: 'updateDeliveryNote',
      security: [{ bearerAuth: [] }],
      params: DeliveryNoteParamsSchema,
      body: DeliveryNoteUpdateSchema,
      response: { 200: DeliveryNoteSingleResponseSchema, 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateDeliveryNote(req.params.businessId, req.params.deliveryNoteId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Surat jalan tidak ditemukan');
      if (error) return sendError(res, 400, 'BadRequest', ERROR_MESSAGES[error]);
      return sendData(res, result);
    },
  });

  app.delete('/:businessId/delivery-notes/:deliveryNoteId', {
    schema: {
      tags: ['DeliveryNote'],
      operationId: 'deleteDeliveryNote',
      security: [{ bearerAuth: [] }],
      params: DeliveryNoteParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const result = await deleteDeliveryNote(req.params.businessId, req.params.deliveryNoteId);
      if (!result.deleted) return sendError(res, 404, 'NotFound', 'Surat jalan tidak ditemukan');
      return res.code(204).send(null);
    },
  });
};