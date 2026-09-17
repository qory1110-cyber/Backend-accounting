import { z } from 'zod';
import { BusinessRoleSchema } from './Business.js';
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

export const CreateUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  assignments: z
    .array(
      z.object({
        businessId: z.string().uuid(),
        role: BusinessRoleSchema,
      }),
    )
    .min(1, 'Minimal 1 bisnis harus dipilih'),
})

export const UserListResponseSchema = z.object({
  data: z.array(UserResponseSchema),
});
