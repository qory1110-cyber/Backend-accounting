import { z } from 'zod';
import { PaginationQuerySchema } from './globals.js';

export const ProjectStatusSchema = z.enum(['active', 'inactive', 'completed']);

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama proyek wajib diisi').max(225),
  code: z.string().trim().max(50).optional(),
  customerId: z.string().uuid().optional(),
  status: ProjectStatusSchema.default('active'),
});

// PATCH: semua field opsional. code dan customerId boleh null supaya
// bisa dikosongkan kembali (beda dari Purchase Orders yang belum bisa).
export const ProjectUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Nama proyek wajib diisi').max(225).optional(),
  code: z.string().trim().max(50).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  status: ProjectStatusSchema.optional(),
});

export const ProjectStatusChangeSchema = z.object({
  status: ProjectStatusSchema,
});

export const ProjectListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().optional(), // nama atau kode proyek
  status: ProjectStatusSchema.optional(),
});

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  status: ProjectStatusSchema,
  // Dihitung dari transaksi yang diberi tag proyek. Tag baru dipasang di
  // Tahap B, jadi sementara selalu 0.
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netProfit: z.number(),
  updatedAt: z.string(),
});

export const ProjectParamsSchema = z.object({
  businessId: z.string().uuid(),
  projectId: z.string().uuid(),
});