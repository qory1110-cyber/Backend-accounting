import { z } from 'zod';
import { createSingleResponseSchema } from './globals.js';

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

export const UpdateMeBodySchema = z.object({
  name: z.string().min(1).optional(),
});

export const UserSingleResponseSchema = createSingleResponseSchema(UserResponseSchema);
