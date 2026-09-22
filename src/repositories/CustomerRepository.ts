import { and, eq } from 'drizzle-orm';
import db from '../db/index.js';
import { contacts } from '../db/schema.js';

// Sama seperti seluruh repository lain: businessId eksplisit, dan di sini
// SELALU filter isCustomer: true - tabel `contacts` dipakai bersama dengan
// modul Suppliers (isSupplier: true), satu kontak boleh dua-duanya sekaligus.

function toResponseShape(row: typeof contacts.$inferSelect) {
  return {
    ...row,
    // Field dihitung, belum ada modul sumbernya (Sales Invoices/Receipts) - lihat catatan di schema.
    accountsReceivable: 0,
    unallocatedReceipts: 0,
  };
}

export async function listCustomers(businessId: string) {
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .orderBy(contacts.name);
  return rows.map(toResponseShape);
}

export async function getCustomerById(businessId: string, customerId: string) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .limit(1);
  return row ? toResponseShape(row) : null;
}

export async function createCustomer(
  businessId: string,
  data: {
    name: string;
    code?: string;
    creditLimit?: number;
    billingAddress?: string;
    deliveryAddress?: string;
    email?: string;
    autofillSalesInvoiceDueDate?: boolean;
  },
) {
  const [row] = await db
    .insert(contacts)
    .values({
      businessId,
      isCustomer: true,
      ...data,
      creditLimit: data.creditLimit?.toString(),
    } as typeof contacts.$inferInsert)
    .returning();
  return toResponseShape(row);
}

export async function updateCustomer(
  businessId: string,
  customerId: string,
  data: Partial<{
    name: string;
    code: string;
    creditLimit: number;
    billingAddress: string;
    deliveryAddress: string;
    email: string;
    autofillSalesInvoiceDueDate: boolean;
  }>,
) {
  const { creditLimit, ...rest } = data;
  const [row] = await db
    .update(contacts)
    .set({
      ...rest,
      ...(creditLimit !== undefined ? { creditLimit: creditLimit.toString() } : {}),
    } as Partial<typeof contacts.$inferInsert>)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

export async function setCustomerActive(businessId: string, customerId: string, isActive: boolean) {
  const [row] = await db
    .update(contacts)
    .set({ isActive })
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

// Larangan hard-delete kalau sudah pernah dipakai transaksi (§8.4 aturan #2).
// Untuk sekarang, satu-satunya "riwayat transaksi" yang bisa dicek adalah
// journal_entry_lines (belum ada Sales Invoices/Receipts) - FK constraint
// di database yang menegakkan ini (lihat isPgForeignKeyViolation di route).
export async function deleteCustomer(businessId: string, customerId: string) {
  const result = await db
    .delete(contacts)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning({ id: contacts.id });
  return result.length > 0;
}