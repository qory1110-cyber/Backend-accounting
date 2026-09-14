import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findUserByEmail, findUserById, updateUserPassword } from '../repositories/UserRepository.js';
import {
  createRefreshToken,
  findValidRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshTokenById,
  revokeRefreshTokenByRawToken,
} from '../repositories/RefreshTokenRepository.js';
import { generateRefreshToken, signAccessToken } from '../libs/jwt.js';
import { hashPassword, verifyPassword } from '../libs/password.js';
import { sendData, sendError } from '../libs/reply.js';
import {
  LoginBodySchema,
  RefreshBodySchema,
  LogoutBodySchema,
  ChangePasswordBodySchema,
  AuthTokensSchema,
} from '../schemas/Auth.js';
import { Unauthorized, Conflict } from '../schemas/globals.js';

export const authRoutesPlugin = async (fastify: FastifyInstance) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/login', {
    schema: {
      tags: ['Auth'],
      operationId: 'login',
      body: LoginBodySchema,
      response: { 200: z.object({ data: AuthTokensSchema }), 401: Unauthorized },
    },
    handler: async (req, res) => {
      const { email, password } = req.body;
      const user = await findUserByEmail(email);

      // Pesan SAMA baik email tidak ditemukan maupun password salah,
      // supaya email terdaftar tidak bisa ditebak (user enumeration).
      if (!user) return sendError(res, 401, 'Unauthorized', 'Email atau password salah');

      const valid = await verifyPassword(user.passwordHash, password);
      if (!valid) return sendError(res, 401, 'Unauthorized', 'Email atau password salah');

      const accessToken = signAccessToken(user.id);
      const refreshToken = generateRefreshToken();
      await createRefreshToken(user.id, refreshToken, req.headers['user-agent']);

      return sendData(res, { accessToken, refreshToken });
    },
  });

  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      operationId: 'refreshToken',
      body: RefreshBodySchema,
      response: { 200: z.object({ data: AuthTokensSchema }), 401: Unauthorized },
    },
    handler: async (req, res) => {
      const existing = await findValidRefreshToken(req.body.refreshToken);
      if (!existing) {
        return sendError(res, 401, 'Unauthorized', 'Refresh token tidak valid atau sudah kedaluwarsa');
      }

      // Rotasi: token lama langsung dicabut begitu dipakai.
      await revokeRefreshTokenById(existing.id);

      const accessToken = signAccessToken(existing.userId);
      const refreshToken = generateRefreshToken();
      await createRefreshToken(existing.userId, refreshToken, req.headers['user-agent']);

      return sendData(res, { accessToken, refreshToken });
    },
  });

  app.post('/logout', {
    schema: {
      tags: ['Auth'],
      operationId: 'logout',
      body: LogoutBodySchema,
      response: { 204: z.null() },
    },
    handler: async (req, res) => {
      await revokeRefreshTokenByRawToken(req.body.refreshToken);
      return res.code(204).send(null);
    },
  });

  app.patch('/change-password', {
    schema: {
      tags: ['Auth'],
      operationId: 'changePassword',
      security: [{ bearerAuth: [] }],
      body: ChangePasswordBodySchema,
      response: { 204: z.null(), 401: Unauthorized, 409: Conflict },
    },
    preHandler: [fastify.requireAuth],
    handler: async (req, res) => {
      const userId = req.user!.id;
      const user = await findUserById(userId);
      if (!user) return sendError(res, 401, 'Unauthorized', 'User tidak ditemukan');

      const oldValid = await verifyPassword(user.passwordHash, req.body.oldPassword);
      if (!oldValid) return sendError(res, 409, 'Conflict', 'Password lama tidak cocok');

      const newHash = await hashPassword(req.body.newPassword);
      await updateUserPassword(userId, newHash);
      await revokeAllRefreshTokensForUser(userId); // cabut semua sesi lain

      return res.code(204).send(null);
    },
  });
};
