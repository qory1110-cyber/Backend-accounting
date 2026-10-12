import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  deleteSupplier,
  listRecentSuppliers,
} from '../repositories/SupplierRepository.js';
import { isPgForeignKeyViolation } from '../libs/safe-error.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  SupplierCreateSchema,
  SupplierUpdateSchema,
  SupplierToggleActiveSchema,
  SupplierResponseSchema,
  RecentSupplierResponseSchema,
  RecentSupplierQuerySchema,
  SupplierListResponseSchema,
  SupplierSingleResponseSchema,
  SupplierParamsSchema,
} from '../schemas/Supplier.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, PaginationQuerySchema, createPaginatedResponseSchema} from '../schemas/globals.js';

// Pola identik CustomerRoutes.ts - READ semua role, WRITE cuma admin.
export const supplierRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:businessId/suppliers', {
    schema: {
      tags: ['Supplier'],
      operationId: 'listSuppliers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(SupplierResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listSuppliers(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/suppliers', {
    schema: {
      tags: ['Supplier'],
      operationId: 'createSupplier',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: SupplierCreateSchema,
      response: { 201: SupplierSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => sendData(res, await createSupplier(req.params.businessId, req.body), 201),
  });

  app.get('/:businessId/suppliers/recent', {
    schema: {
      tags: ['Supplier'],
      operationId: 'listRecentSuppliers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: RecentSupplierQuerySchema,
      response: { 200: RecentSupplierResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await listRecentSuppliers(req.params.businessId, req.query.limit)),
  });

  app.get('/:businessId/suppliers/:supplierId', {
    schema: {
      tags: ['Supplier'],
      operationId: 'getSupplier',
      security: [{ bearerAuth: [] }],
      params: SupplierParamsSchema,
      response: { 200: SupplierSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getSupplierById(req.params.businessId, req.params.supplierId);
      if (!row) return sendError(res, 404, 'NotFound', 'Pemasok tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/suppliers/:supplierId', {
    schema: {
      tags: ['Supplier'],
      operationId: 'updateSupplier',
      security: [{ bearerAuth: [] }],
      params: SupplierParamsSchema,
      body: SupplierUpdateSchema,
      response: { 200: SupplierSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await updateSupplier(req.params.businessId, req.params.supplierId, req.body);
      if (!row) return sendError(res, 404, 'NotFound', 'Pemasok tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/suppliers/:supplierId/active', {
    schema: {
      tags: ['Supplier'],
      operationId: 'setSupplierActive',
      security: [{ bearerAuth: [] }],
      params: SupplierParamsSchema,
      body: SupplierToggleActiveSchema,
      response: { 200: SupplierSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await setSupplierActive(req.params.businessId, req.params.supplierId, req.body.isActive);
      if (!row) return sendError(res, 404, 'NotFound', 'Pemasok tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/suppliers/:supplierId', {
    schema: {
      tags: ['Supplier'],
      operationId: 'deleteSupplier',
      security: [{ bearerAuth: [] }],
      params: SupplierParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      try {
        const deleted = await deleteSupplier(req.params.businessId, req.params.supplierId);
        if (!deleted) return sendError(res, 404, 'NotFound', 'Pemasok tidak ditemukan');
        return res.code(204).send(null);
      } catch (err) {
        if (isPgForeignKeyViolation(err)) {
          return sendError(res, 409, 'Conflict', 'Pemasok ini sudah punya riwayat transaksi, gunakan status Inactive alih-alih menghapus');
        }
        throw err;
      }
    },
  });
};