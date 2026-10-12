import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createBusinessWithAdmin,
  listBusinessesForUser,
  findBusinessById,
  updateBusiness,
  findModulesWithDataAmongNewlyHidden,
  deleteBusiness,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from '../repositories/BusinessRepository.js';
import { findUserByEmail, createUser } from '../repositories/UserRepository.js';
import { sendData, sendError, sendPaginated } from '../libs/reply.js';
import { isPgUniqueViolation } from '../libs/safe-error.js';
import { randomBytes } from 'crypto';
import { hashPassword } from '../libs/password.js';
import {
  BusinessCreateSchema,
  BusinessUpdateSchema,
  MemberResponseSchema,
  BusinessListResponseSchema,
  BusinessSingleResponseSchema,
  BusinessParamsSchema,
  BusinessDeleteBodySchema,
  MemberInviteBodySchema,
  MemberRoleUpdateBodySchema,
  MemberParamsSchema,
  MemberListResponseSchema,
} from '../schemas/Business.js';
import { Unauthorized, Forbidden, NotFound, Conflict, BadRequest, PaginationQuerySchema, createPaginatedResponseSchema } from '../schemas/globals.js';

export const businessRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- Businesses (tugas #5: daftar bisnis yang bisa diakses user login) ---

  app.get('/', {
    schema: {
      tags: ['Business'],
      operationId: 'listMyBusinesses',
      security: [{ bearerAuth: [] }],
      response: { 200: BusinessListResponseSchema, 401: Unauthorized },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const rows = await listBusinessesForUser(req.user!.id);
      return sendData(res, rows);
    },
  });

  app.post('/', {
    schema: {
      tags: ['Business'],
      operationId: 'createBusiness',
      security: [{ bearerAuth: [] }],
      body: BusinessCreateSchema,
      response: { 201: BusinessSingleResponseSchema, 401: Unauthorized },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const business = await createBusinessWithAdmin(req.user!.id, req.body);
      return sendData(res, business, 201);
    },
  });

  app.get('/:businessId', {
    schema: {
      tags: ['Business'],
      operationId: 'getBusiness',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      response: { 200: BusinessSingleResponseSchema, 401: Unauthorized, 404: NotFound },
    },
    // requireBusinessScope WAJIB setelah requireAuth (§2.4) — ini yang
    // menegakkan isolasi multi-tenant untuk endpoint ini (tugas #3).
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const business = await findBusinessById(req.params.businessId);
      if (!business) return sendError(res, 404, 'NotFound', 'Bisnis tidak ditemukan');
      return sendData(res, { ...business, role: req.businessRole });
    },
  });

  app.patch('/:businessId', {
    schema: {
      tags: ['Business'],
      operationId: 'updateBusiness',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: BusinessUpdateSchema,
      response: {
        200: BusinessSingleResponseSchema,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const existing = await findBusinessById(req.params.businessId);
      if (!existing) return sendError(res, 404, 'NotFound', 'Bisnis tidak ditemukan');

      // Manager.io asli: modul yang masih punya data tidak boleh disembunyikan,
      // supaya tidak ada data yang "hilang dari pandangan" tanpa sengaja.
      if (req.body.hiddenModules) {
        const withData = await findModulesWithDataAmongNewlyHidden(
          req.params.businessId,
          existing.hiddenModules,
          req.body.hiddenModules,
        );
        if (withData.length > 0) {
          return sendError(
            res,
            409,
            'Conflict',
            `Modul berikut masih punya data, kosongkan dulu sebelum disembunyikan: ${withData.join(', ')}`,
          );
        }
      }

      const business = await updateBusiness(req.params.businessId, req.body);
      if (!business) return sendError(res, 404, 'NotFound', 'Bisnis tidak ditemukan');
      return sendData(res, business);
    },
  });

  // --- Anggota bisnis (tugas #4: hak akses per bisnis) ------------------

  app.get('/:businessId/members', {
    schema: {
      tags: ['Business'],
      operationId: 'listBusinessMembers',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      querystring: PaginationQuerySchema,
      response: { 200: createPaginatedResponseSchema(MemberResponseSchema), 401: Unauthorized, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope],
    handler: async (req, res) => {
      const { page, pageSize } = req.query;
      const { data, total } = await listMembers(req.params.businessId, page, pageSize);
      return sendPaginated(res, data, total, page, pageSize);
    },
  });

  app.post('/:businessId/members', {
    schema: {
      tags: ['Business'],
      operationId: 'inviteBusinessMember',
      security: [{ bearerAuth: [] }],
      params: BusinessParamsSchema,
      body: MemberInviteBodySchema,
      response: {
        201: MemberListResponseSchema,
        401: Unauthorized,
        403: Forbidden,
        404: NotFound,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const { businessId } = req.params;
      const { email, role } = req.body;

      let user = await findUserByEmail(email);
      let status: 'invited' | 'active' = 'active';

      if (!user) {
        // Email belum terdaftar sama sekali di sistem — buat akun placeholder
        // berstatus "invited" dengan password acak (bukan diberi tahu ke
        // siapa pun; alur set-password-lewat-email adalah pekerjaan lanjutan
        // di luar 6 subtugas 1.2 ini).
        const randomPasswordHash = await hashPassword(randomBytes(24).toString('hex'));
        user = await createUser({ name: email.split('@')[0], email, passwordHash: randomPasswordHash });
        status = 'invited';
      }

      try {
        await addMember(businessId, user.id, role, status);
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return sendError(res, 409, 'Conflict', 'User ini sudah jadi anggota bisnis ini');
        }
        throw err;
      }

      const { data: rows } = await listMembers(businessId, 1, 1000);
return sendData(res, rows, 201);
    },
  });

  app.patch('/:businessId/members/:userId', {
    schema: {
      tags: ['Business'],
      operationId: 'updateBusinessMemberRole',
      security: [{ bearerAuth: [] }],
      params: MemberParamsSchema,
      body: MemberRoleUpdateBodySchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const row = await updateMemberRole(req.params.businessId, req.params.userId, req.body.role);
      if (!row) return sendError(res, 404, 'NotFound', 'Anggota tidak ditemukan di bisnis ini');
      return res.code(204).send(null);
    },
  });

  app.delete('/:businessId/members/:userId', {
    schema: {
      tags: ['Business'],
      operationId: 'removeBusinessMember',
      security: [{ bearerAuth: [] }],
      params: MemberParamsSchema,
      response: { 204: z.null(), 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const removed = await removeMember(req.params.businessId, req.params.userId);
      if (!removed) return sendError(res, 404, 'NotFound', 'Anggota tidak ditemukan di bisnis ini');
      return res.code(204).send(null);
    },
  });

  app.delete('/:businessId', {
  schema: {
    tags: ['Business'],
    operationId: 'deleteBusiness',
    security: [{ bearerAuth: [] }],
    params: BusinessParamsSchema,
    body: BusinessDeleteBodySchema,
    response: { 204: z.null(), 400: BadRequest, 401: Unauthorized, 403: Forbidden, 404: NotFound },
    },
    preHandler: [fastify.requireAuth, fastify.requireBusinessScope, fastify.requireRole('admin')],
    handler: async (req, res) => {
      const business = await findBusinessById(req.params.businessId);
      if (!business) return sendError(res, 404, 'NotFound', 'Bisnis tidak ditemukan');

      // Verifikasi: nama harus diketik PERSIS sama - dicek di server, bukan cuma di frontend,
      // supaya tidak bisa "dilewati" dengan memanggil API langsung.
      if (req.body.confirmName !== business.name) {
      return sendError(res, 400, 'BadRequest', 'Nama bisnis yang diketik tidak cocok');
      }

      await deleteBusiness(req.params.businessId);
      return res.code(204).send(null);
    },
  });
};
