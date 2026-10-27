import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  setProjectStatus,
  deleteProject,
} from '../repositories/ProjectRepository.js';
import { isPgForeignKeyViolation } from '../libs/safe-error.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectStatusChangeSchema,
  ProjectListQuerySchema,
  ProjectResponseSchema,
  ProjectParamsSchema,
} from '../schemas/Project.js';
import { BusinessParamsSchema } from '../schemas/Business.js';
import {
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  BadRequest,
  createPaginatedResponseSchema,
  createSingleResponseSchema,
} from '../schemas/globals.js';

// READ: semua role. WRITE: admin dan accountant.
export const projectRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const writeGuards = [
    fastify.requireAuth,
    fastify.requireBusinessScope,
    fastify.requireRole('admin', 'accountant'),
  ];

  app.get('/:businessId/projects', {
    schema: {
      tags: ['Project'],
      operationId: 'listProjects',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: ProjectListQuerySchema,
      response: { 200: createPaginatedResponseSchema(ProjectResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize, search, status } = req.query;
      const { data, total } = await listProjects(req.params.businessId, page, pageSize, { search, status });
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/projects', {
    schema: {
      tags: ['Project'],
      operationId: 'createProject',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: ProjectCreateSchema,
      response: {
        201: createSingleResponseSchema(ProjectResponseSchema),
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
      },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await createProject(req.params.businessId, req.body);
      if (error === 'INVALID_CUSTOMER') {
        return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid: harus pelanggan aktif di bisnis ini');
      }
      return sendData(res, result, 201);
    },
  });

  app.get('/:businessId/projects/:projectId', {
    schema: {
      tags: ['Project'],
      operationId: 'getProject',
      security: [{ bearerAuth: [] }],
      params: ProjectParamsSchema,
      response: { 200: createSingleResponseSchema(ProjectResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const row = await getProjectById(req.params.businessId, req.params.projectId);
      if (!row) return sendError(res, 404, 'NotFound', 'Proyek tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.patch('/:businessId/projects/:projectId', {
    schema: {
      tags: ['Project'],
      operationId: 'updateProject',
      security: [{ bearerAuth: [] }],
      params: ProjectParamsSchema,
      body: ProjectUpdateSchema,
      response: {
        200: createSingleResponseSchema(ProjectResponseSchema),
        400: BadRequest,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
      },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const { result, error } = await updateProject(req.params.businessId, req.params.projectId, req.body);
      if (error === 'NOT_FOUND') return sendError(res, 404, 'NotFound', 'Proyek tidak ditemukan');
      if (error === 'INVALID_CUSTOMER') {
        return sendError(res, 400, 'BadRequest', 'Pelanggan tidak valid: harus pelanggan aktif di bisnis ini');
      }
      return sendData(res, result);
    },
  });

  app.patch('/:businessId/projects/:projectId/status', {
    schema: {
      tags: ['Project'],
      operationId: 'setProjectStatus',
      security: [{ bearerAuth: [] }],
      params: ProjectParamsSchema,
      body: ProjectStatusChangeSchema,
      response: { 200: createSingleResponseSchema(ProjectResponseSchema), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      const row = await setProjectStatus(req.params.businessId, req.params.projectId, req.body.status);
      if (!row) return sendError(res, 404, 'NotFound', 'Proyek tidak ditemukan');
      return sendData(res, row);
    },
  });

  app.delete('/:businessId/projects/:projectId', {
    schema: {
      tags: ['Project'],
      operationId: 'deleteProject',
      security: [{ bearerAuth: [] }],
      params: ProjectParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound, 409: Conflict },
    },
    preHandler: writeGuards,
    handler: async (req, res) => {
      try {
        const deleted = await deleteProject(req.params.businessId, req.params.projectId);
        if (!deleted) return sendError(res, 404, 'NotFound', 'Proyek tidak ditemukan');
        return res.code(204).send(null);
      } catch (err) {
        if (isPgForeignKeyViolation(err)) {
          return sendError(
            res,
            409,
            'Conflict',
            'Proyek ini sudah dipakai transaksi, ubah statusnya menjadi Inactive atau Completed alih-alih menghapus',
          );
        }
        throw err;
      }
    },
  });
};