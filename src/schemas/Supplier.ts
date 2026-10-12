import { z } from 'zod';

export const SupplierCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().max(50).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  address: z.string().optional(), // dipetakan ke kolom billingAddress
  email: z.string().email().optional(),
});

export const SupplierUpdateSchema = SupplierCreateSchema.partial();

export const SupplierToggleActiveSchema = z.object({
  isActive: z.boolean(),
});

export const SupplierResponseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  creditLimit: z.string(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  // Dihitung dari Purchase Invoices - Payments. BELUM ada modulnya - lihat
  // catatan yang sama seperti Customer.accountsReceivable.
  accountsPayable: z.number(),
  unallocatedPayments: z.number(),
});

export const SupplierListResponseSchema = z.object({
  data: z.array(SupplierResponseSchema),
});

export const SupplierSingleResponseSchema = z.object({
  data: SupplierResponseSchema,
});

export const SupplierParamsSchema = z.object({
  businessId: z.string().uuid(),
  supplierId: z.string().uuid(),
});

export const RecentSupplierResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
    isActive: z.boolean(),
  })),
});

export const RecentSupplierQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});