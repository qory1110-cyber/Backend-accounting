import { z } from 'zod';
import { createSingleResponseSchema } from './globals.js';

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const RefreshBodySchema = z.object({
  refreshToken: z.string(),
});

export const LogoutBodySchema = z.object({
  refreshToken: z.string(),
});

export const ChangePasswordBodySchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string().min(8),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const AuthTokensResponseSchema = createSingleResponseSchema(AuthTokensSchema);
