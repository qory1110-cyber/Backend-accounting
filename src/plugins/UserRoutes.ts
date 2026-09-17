import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomBytes } from 'crypto';
import {
  findUserById,
  findUserByEmail,
  createUser,
  updateUserProfile,
  listUsersSharingBusiness,
} from '../repositories/UserRepository.js';
import { findMembership, addMember } from '../repositories/BusinessRepository.js';
import { hashPassword } from '../libs/password.js';
import { isPgUniqueViolation } from '../libs/safe-error.js';
import { sendData, sendError } from '../libs/reply.js';
import {
  UpdateMeBodySchema,
  UserSingleResponseSchema,
  UserListResponseSchema,
  CreateUserBodySchema,
} from '../schemas/User.js';
import { Unauthorized, Forbidden, Conflict } from '../schemas/globals.js';

export const userRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/me', {
    schema: {
      tags: ['User'],
      operationId: 'getMe',
      security: [{ bearerAuth: [] }],
      response: { 200: UserSingleResponseSchema, 401: Unauthorized },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const user = await findUserById(req.user!.id);
      if (!user) return sendError(res, 401, 'Unauthorized', 'User tidak ditemukan');
      return sendData(res, { id: user.id, name: user.name, email: user.email });
    },
  });

  app.patch('/me', {
    schema: {
      tags: ['User'],
      operationId: 'updateMe',
      security: [{ bearerAuth: [] }],
      body: UpdateMeBodySchema,
      response: { 200: UserSingleResponseSchema, 401: Unauthorized },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const user = await updateUserProfile(req.user!.id, req.body);
      if (!user) return sendError(res, 401, 'Unauthorized', 'User tidak ditemukan');
      return sendData(res, { id: user.id, name: user.name, email: user.email });
    },
  });

  // --- Baru: daftar & tambah user (lintas bisnis yang kamu ikuti) ---

  app.get('/', {
    schema: {
      tags: ['User'],
      operationId: 'listUsers',
      security: [{ bearerAuth: [] }],
      response: { 200: UserListResponseSchema, 401: Unauthorized },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const rows = await listUsersSharingBusiness(req.user!.id);
      return sendData(res, rows);
    },
  });

  app.post('/', {
    schema: {
      tags: ['User'],
      operationId: 'createUser',
      security: [{ bearerAuth: [] }],
      body: CreateUserBodySchema,
      response: {
        201: UserSingleResponseSchema,
        401: Unauthorized,
        403: Forbidden,
        409: Conflict,
      },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const currentUserId = req.user!.id;
const { name, email, password, assignments } = req.body;

      for (const a of assignments) {
        const membership = await findMembership(currentUserId, a.businessId);
        if (!membership || membership.role !== 'admin') {
          return sendError(
            res,
            403,
            'Forbidden',
            'Kamu harus jadi admin di setiap bisnis yang dipilih',
          );
        }
      }

      let user = await findUserByEmail(email);
const isNewUser = !user;

if (!user) {
  // Password ditentukan manual oleh admin (bukan acak lagi) - solusi sementara
  // sampai alur "Set Password via Email" dibangun. Admin bertanggung jawab
  // memberitahukan password ini ke orangnya secara langsung/luar sistem.
  const passwordHash = await hashPassword(password);
  user = await createUser({ name, email, passwordHash });
}
// Kalau user SUDAH ada sebelumnya, password yang dikirim di request ini
// diabaikan - tidak mengubah password akun yang sudah ada.

      let anyNewAssignment = false;

for (const a of assignments) {
  try {
    await addMember(a.businessId, user.id, a.role, isNewUser ? 'invited' : 'active');
    anyNewAssignment = true;
  } catch (err) {
    if (isPgUniqueViolation(err)) continue;
    throw err;
  }
}

// User sudah ada sebelumnya (bukan baru dibuat) DAN semua assignment ternyata
// duplikat - berarti tidak ada satupun perubahan nyata yang terjadi.
if (!isNewUser && !anyNewAssignment) {
  return sendError(
    res,
    409,
    'Conflict',
    'User ini sudah terdaftar dan sudah menjadi anggota di bisnis yang dipilih',
  );
}

return sendData(res, { id: user.id, name: user.name, email: user.email }, 201);
    },
  });
};