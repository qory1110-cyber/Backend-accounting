import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  setCustomerActive,
  deleteCustomer,
} from '../repositories/CustomerRepository.js';
import { isPgForeignKeyViolation } from '../libs/safe-error.js';
import { sendData, sendError } from '../libs/reply.js';
import {
  CustomerCreateSchema,
  CustomerUpdateSchema,
  CustomerToggleActiveSchema,
  CustomerListResponseSchema,
  CustomerSingleResponseSchema,
  CustomerParamsSchema,
} from '../schemas/Customer.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict } from '../schemas/globals.js';

// §8.2 dokumen analisis: Admin atur credit limit & pantau saldo; Staf
// Billing/Penjualan pilih data pelanggan saat transaksi - jadi READ boleh
// semua role, WRITE (create/update/delete/toggle) cuma admin, sama seperti
// Chart of Accounts.
export const customerRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:businessId/customers', {
    schema: {
      tags: ['Customer'],
      operationId: 'listCustomers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: CustomerListResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => sendData(res, await listCustomers(req.params.businessId)),
  });

  app.post('/:businessId/customers', {
    schema: {
      tags: ['Customer'],
      operationId: 'createCustomer',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: CustomerCreateSchema,
      response: { 201: CustomerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await createCustomer(req.params.businessId, req.body);
      return sendData(res, row, 201);
    },
  });

  app.get('/:businessId/customers/:customerId', {
    schema: {
      tags: ['Customer'],
      operationId: 'getCustomer',
      security: [{ bearerAuth: [] }],
      params: CustomerParamsSchema,
      response: { 200: CustomerSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getCustomerById(req.params.businessId, req.params.customerId);
      if (!row) return sendError(res, 404, 'NotFound', 'Pelanggan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/customers/:customerId', {
    schema: {
      tags: ['Customer'],
      operationId: 'updateCustomer',
      security: [{ bearerAuth: [] }],
      params: CustomerParamsSchema,
      body: CustomerUpdateSchema,
      response: { 200: CustomerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await updateCustomer(req.params.businessId, req.params.customerId, req.body);
      if (!row) return sendError(res, 404, 'NotFound', 'Pelanggan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/customers/:customerId/active', {
    schema: {
      tags: ['Customer'],
      operationId: 'setCustomerActive',
      security: [{ bearerAuth: [] }],
      params: CustomerParamsSchema,
      body: CustomerToggleActiveSchema,
      response: { 200: CustomerSingleResponseSchema, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await setCustomerActive(req.params.businessId, req.params.customerId, req.body.isActive);
      if (!row) return sendError(res, 404, 'NotFound', 'Pelanggan tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/customers/:customerId', {
    schema: {
      tags: ['Customer'],
      operationId: 'deleteCustomer',
      security: [{ bearerAuth: [] }],
      params: CustomerParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      try {
        const deleted = await deleteCustomer(req.params.businessId, req.params.customerId);
        if (!deleted) return sendError(res, 404, 'NotFound', 'Pelanggan tidak ditemukan');
        return res.code(204).send(null);
      } catch (err) {
        if (isPgForeignKeyViolation(err)) {
          return sendError(
            res,
            409,
            'Conflict',
            'Pelanggan ini sudah punya riwayat transaksi, gunakan status Inactive alih-alih menghapus',
          );
        }
        throw err;
      }
    },
  });
};