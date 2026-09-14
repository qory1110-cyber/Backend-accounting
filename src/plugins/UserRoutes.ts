import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { findUserById, updateUserProfile } from '../repositories/UserRepository.js';
import { sendData, sendError } from '../libs/reply.js';
import { UpdateMeBodySchema, UserSingleResponseSchema } from '../schemas/User.js';
import { Unauthorized } from '../schemas/globals.js';

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
};
