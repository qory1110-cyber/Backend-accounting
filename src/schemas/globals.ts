import { z } from 'zod';

// Bentuk error baku — sama untuk SEMUA endpoint, dipakai di `response: { 401: Unauthorized, ... }`
// pada setiap route supaya muncul juga di dokumentasi Swagger.
const errorShape = z.object({
  error: z.string(),
  message: z.string(),
});

export const Unauthorized = errorShape.describe('Belum login / token tidak valid');
export const Forbidden = errorShape.describe('Sudah login, tapi tidak punya izin');
export const NotFound = errorShape.describe('Data tidak ditemukan');
export const BadRequest = errorShape.describe('Input tidak valid');
export const Conflict = errorShape.describe('Konflik data (mis. email sudah dipakai)');
export const InternalServerError = errorShape.describe('Kesalahan tak terduga di server');

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      total: z.number(),
      currentPage: z.number(),
      totalPages: z.number(),
      pageSize: z.number(),
    }),
  });
}

export function createSingleResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({ data: itemSchema });
}
