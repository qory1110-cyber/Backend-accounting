import { z } from 'zod';

export const CustomerCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().max(50).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  billingAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  email: z.string().email().optional(),
  autofillSalesInvoiceDueDate: z.boolean().optional(),
});

export const CustomerUpdateSchema = CustomerCreateSchema.partial();

export const CustomerToggleActiveSchema = z.object({
  isActive: z.boolean(),
});

export const CustomerResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  creditLimit: z.string(), // numeric Drizzle balik sebagai string, konsisten dengan konvensi kita
  billingAddress: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  email: z.string().nullable(),
  autofillSalesInvoiceDueDate: z.boolean(),
  isActive: z.boolean(),
  // Dihitung dari Sales Invoices - Receipts. Kedua modul itu BELUM ada
  // (lihat urutan Fase 2) - sengaja hardcode 0 dulu, struktur field sudah
  // siap supaya tidak perlu ubah kontrak API saat modul itu dibangun nanti.
  accountsReceivable: z.number(),
  unallocatedReceipts: z.number(),
});

export const CustomerListResponseSchema = z.object({
  data: z.array(CustomerResponseSchema),
});

export const CustomerSingleResponseSchema = z.object({
  data: CustomerResponseSchema,
});

export const CustomerParamsSchema = z.object({
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
});