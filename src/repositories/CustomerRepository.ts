import { and, eq, sql, desc } from 'drizzle-orm';
import db from '../db/index.js';
import { contacts, salesInvoices, salesInvoiceLines, receiptLines } from '../db/schema.js';

async function computeAccountsReceivable(customerId: string): Promise<number> {
  const [invoiceTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesInvoiceLines.qty} * ${salesInvoiceLines.unitPrice}), 0)` })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoiceLines.salesInvoiceId, salesInvoices.id))
    .where(and(eq(salesInvoices.customerId, customerId), eq(salesInvoices.status, 'sent')));

  const [allocatedTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptLines.amount}), 0)` })
    .from(receiptLines)
    .innerJoin(salesInvoices, eq(receiptLines.salesInvoiceId, salesInvoices.id))
    .where(and(eq(salesInvoices.customerId, customerId), eq(salesInvoices.status, 'sent')));

  return Number(invoiceTotal.total) - Number(allocatedTotal.total);
}

async function toResponseShape(row: typeof contacts.$inferSelect) {
  return {
    ...row,
    accountsReceivable: await computeAccountsReceivable(row.id),
    unallocatedReceipts: 0,
  };
}

export async function listCustomers(businessId: string, page: number, pageSize: number) {
  const whereClause = and(eq(contacts.businessId, businessId), eq(contacts.isCustomer, true));

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

// Untuk dropdown pencarian: ringan (tanpa accountsReceivable yang mahal
// dihitung), diurutkan dari yang TERAKHIR DIUBAH, dibatasi jumlahnya.
export async function listRecentCustomers(businessId: string, limit: number) {
  return db
    .select({ id: contacts.id, name: contacts.name, code: contacts.code, isActive: contacts.isActive })
    .from(contacts)
    .where(and(eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .orderBy(desc(contacts.updatedAt), contacts.name)
    .limit(limit);
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
      updatedAt: new Date(),
    } as Partial<typeof contacts.$inferInsert>)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

export async function setCustomerActive(businessId: string, customerId: string, isActive: boolean) {
  const [row] = await db
    .update(contacts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning();
  return row ? toResponseShape(row) : null;
}

export async function deleteCustomer(businessId: string, customerId: string) {
  const result = await db
    .delete(contacts)
    .where(and(eq(contacts.id, customerId), eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)))
    .returning({ id: contacts.id });
  return result.length > 0;
}