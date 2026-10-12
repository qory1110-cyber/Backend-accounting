import { and, eq, sql, desc } from 'drizzle-orm';
import db from '../db/index.js';
import { contacts, purchaseInvoices, purchaseInvoiceLines, paymentLines } from '../db/schema.js';

// accountsPayable dihitung dari Purchase Invoices berstatus approved, dikurangi
// alokasi Payments - logika yang sama dengan balanceDue pada
// PurchaseInvoiceRepository, sama seperti accountsReceivable pada Customer.
// unallocatedPayments masih hardcode 0 - menunggu pelacakan pembayaran yang
// belum dialokasikan ke faktur tertentu, belum diimplementasikan.
async function computeAccountsPayable(supplierId: string): Promise<number> {
  const [invoiceTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchaseInvoiceLines.qty} * ${purchaseInvoiceLines.unitPrice}), 0)` })
    .from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoices.id))
    .where(and(eq(purchaseInvoices.supplierId, supplierId), eq(purchaseInvoices.status, 'approved')));

  const [paidTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .innerJoin(purchaseInvoices, eq(paymentLines.purchaseInvoiceId, purchaseInvoices.id))
    .where(and(eq(purchaseInvoices.supplierId, supplierId), eq(purchaseInvoices.status, 'approved')));

  return Number(invoiceTotal.total) - Number(paidTotal.total);
}

async function toResponseShape(row: typeof contacts.$inferSelect) {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    code: row.code,
    creditLimit: row.creditLimit,
    address: row.billingAddress,
    email: row.email,
    isActive: row.isActive,
    accountsPayable: await computeAccountsPayable(row.id),
    unallocatedPayments: 0,
  };
}

export async function listSuppliers(businessId: string, page: number, pageSize: number) {
  const whereClause = and(eq(contacts.businessId, businessId), eq(contacts.isSupplier, true));

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contacts)
    .where(whereClause);

  const rows = await db
    .select()
    .from(contacts)
    .where(whereClause)
    .orderBy(contacts.name, contacts.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(toResponseShape));
  return { data, total: Number(count) };
}

// Untuk dropdown pencarian: ringan, diurutkan dari yang TERAKHIR DIUBAH.
export async function listRecentSuppliers(businessId: string, limit: number) {
  return db
    .select({ id: contacts.id, name: contacts.name, code: contacts.code, isActive: contacts.isActive })
    .from(contacts)
    .where(and(eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
    .orderBy(desc(contacts.updatedAt), contacts.name)
    .limit(limit);
}

export async function getSupplierById(businessId: string, supplierId: string) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, supplierId), eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
    .limit(1);
  return row ? toResponseShape(row) : null;
}

export async function createSupplier(
  businessId: string,
  data: { name: string; code?: string; creditLimit?: number; address?: string; email?: string },
) {
  const { address, ...rest } = data;
  const [row] = await db
    .insert(contacts)
    .values({
      businessId,
      isSupplier: true,
      ...rest,
      billingAddress: address,
      creditLimit: data.creditLimit?.toString(),
    } as typeof contacts.$inferInsert)
    .returning();
  return toResponseShape(row);
}

export async function updateSupplier(
  businessId: string,
  supplierId: string,
  data: Partial<{ name: string; code: string; creditLimit: number; address: string; email: string }>,
) {
  const { address, creditLimit, ...rest } = data;
  const [row] = await db
    .update(contacts)
    .set({
      ...rest,
      ...(address !== undefined ? { billingAddress: address } : {}),
      ...(creditLimit !== undefined ? { creditLimit: creditLimit.toString() } : {}),
      updatedAt: new Date(),
    } as Partial<typeof contacts.$inferInsert>)
    .where(and(eq(contacts.id, supplierId), eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

export async function setSupplierActive(businessId: string, supplierId: string, isActive: boolean) {
  const [row] = await db
    .update(contacts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(contacts.id, supplierId), eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

export async function deleteSupplier(businessId: string, supplierId: string) {
  const result = await db
    .delete(contacts)
    .where(and(eq(contacts.id, supplierId), eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)))
    .returning({ id: contacts.id });
  return result.length > 0;
}