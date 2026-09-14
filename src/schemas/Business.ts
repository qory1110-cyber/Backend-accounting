import { z } from 'zod';
import { createSingleResponseSchema } from './globals.js';

export const BusinessRoleSchema = z.enum(['admin', 'accountant', 'viewer']);

export const BusinessCreateSchema = z.object({
  name: z.string().min(1),
  baseCurrencyCode: z.string().length(3).default('IDR'),
});

export const BusinessUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  baseCurrencyCode: z.string().length(3).optional(),
});

export const BusinessResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  baseCurrencyCode: z.string(),
  role: BusinessRoleSchema.optional(), // ada saat muncul di daftar "bisnis saya", tidak ada saat GET detail
});

export const BusinessListResponseSchema = z.object({
  data: z.array(BusinessResponseSchema),
});

export const BusinessSingleResponseSchema = createSingleResponseSchema(BusinessResponseSchema);

export const BusinessParamsSchema = z.object({
  businessId: z.string().uuid(),
});

export const MemberInviteBodySchema = z.object({
  email: z.string().email(),
  role: BusinessRoleSchema,
});

export const MemberRoleUpdateBodySchema = z.object({
  role: BusinessRoleSchema,
});

export const MemberParamsSchema = z.object({
  businessId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const MemberResponseSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: BusinessRoleSchema,
  status: z.string(),
});

export const MemberListResponseSchema = z.object({
  data: z.array(MemberResponseSchema),
});
