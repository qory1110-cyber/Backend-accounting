import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { latePaymentFees, salesInvoices, contacts } from '../db/schema.js';

// Customer harus is_customer, aktif, dan milik bisnis ini.
async function isValidCustomer(businessId: string, customerId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, customerId),
        eq(contacts.businessId, businessId),
        eq(contacts.isCustomer, true),
        eq(contacts.isActive, true),
      ),
    )
    .limit(1);
  return !!row;
}

// Faktur harus milik bisnis ini, berstatus 'sent', dan milik pelanggan yang sama dengan denda.
async function checkInvoice(businessId: string, salesInvoiceId: string, customerId: string) {
  const [invoice] = await db
    .select({ customerId: salesInvoices.customerId, status: salesInvoices.status })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
    .limit(1);
  if (!invoice || invoice.status !== 'sent') return 'INVALID_INVOICE' as const;
  if (invoice.customerId !== customerId) return 'INVOICE_CUSTOMER_MISMATCH' as const;
  return null;
}

function baseQuery() {
  return db
    .select({
      id: latePaymentFees.id,
      businessId: latePaymentFees.businessId,
      customerId: latePaymentFees.customerId,
      customerName: contacts.name,
      salesInvoiceId: latePaymentFees.salesInvoiceId,
      salesInvoiceReference: salesInvoices.reference,
      salesInvoiceDate: salesInvoices.issueDate,
      feeDate: latePaymentFees.feeDate,
      amount: latePaymentFees.amount,
    })
    .from(latePaymentFees)
    .innerJoin(contacts, eq(latePaymentFees.customerId, contacts.id))
    .innerJoin(salesInvoices, eq(latePaymentFees.salesInvoiceId, salesInvoices.id));
}

function toOutput<T extends { amount: string }>(row: T) {
  return { ...row, amount: Number(row.amount) };
}

export async function listLatePaymentFees(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(latePaymentFees.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(latePaymentFees.feeDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(latePaymentFees.feeDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(contacts.name, pattern), ilike(salesInvoices.reference, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(latePaymentFees)
    .innerJoin(contacts, eq(latePaymentFees.customerId, contacts.id))
    .innerJoin(salesInvoices, eq(latePaymentFees.salesInvoiceId, salesInvoices.id))
    .where(where);

  const rows = await baseQuery()
    .where(where)
    .orderBy(desc(latePaymentFees.feeDate), desc(latePaymentFees.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data: rows.map(toOutput), total: Number(count) };
}

async function getLatePaymentFeeById(businessId: string, latePaymentFeeId: string) {
  const [row] = await baseQuery()
    .where(and(eq(latePaymentFees.id, latePaymentFeeId), eq(latePaymentFees.businessId, businessId)))
    .limit(1);
  return row ? toOutput(row) : null;
}

export async function createLatePaymentFee(
  businessId: string,
  data: { customerId: string; salesInvoiceId: string; feeDate: string; amount: number },
) {
  if (!(await isValidCustomer(businessId, data.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }
  const invoiceError = await checkInvoice(businessId, data.salesInvoiceId, data.customerId);
  if (invoiceError) return { result: null, error: invoiceError };

  const [row] = await db
    .insert(latePaymentFees)
    .values({
      businessId,
      customerId: data.customerId,
      salesInvoiceId: data.salesInvoiceId,
      feeDate: data.feeDate,
      amount: data.amount.toString(),
    })
    .returning({ id: latePaymentFees.id });

  return { result: await getLatePaymentFeeById(businessId, row.id), error: null };
}

export async function updateLatePaymentFee(
  businessId: string,
  latePaymentFeeId: string,
  data: Partial<{ customerId: string; salesInvoiceId: string; feeDate: string; amount: number }>,
) {
  const [existing] = await db
    .select()
    .from(latePaymentFees)
    .where(and(eq(latePaymentFees.id, latePaymentFeeId), eq(latePaymentFees.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  // Pelanggan hanya divalidasi bila diganti; ubah nominal/tanggal tidak terblokir oleh status pelanggan.
  if (data.customerId && !(await isValidCustomer(businessId, data.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }
  // Bila pelanggan atau faktur diganti, pasangan akhirnya harus tetap konsisten.
  if (data.customerId || data.salesInvoiceId) {
    const invoiceError = await checkInvoice(
      businessId,
      data.salesInvoiceId ?? existing.salesInvoiceId,
      data.customerId ?? existing.customerId,
    );
    if (invoiceError) return { result: null, error: invoiceError };
  }

  const values: Partial<typeof latePaymentFees.$inferInsert> = {};
  if (data.customerId !== undefined) values.customerId = data.customerId;
  if (data.salesInvoiceId !== undefined) values.salesInvoiceId = data.salesInvoiceId;
  if (data.feeDate !== undefined) values.feeDate = data.feeDate;
  if (data.amount !== undefined) values.amount = data.amount.toString();

  if (Object.keys(values).length > 0) {
    await db.update(latePaymentFees).set(values).where(eq(latePaymentFees.id, latePaymentFeeId));
  }

  return { result: await getLatePaymentFeeById(businessId, latePaymentFeeId), error: null };
}

export async function deleteLatePaymentFee(businessId: string, latePaymentFeeId: string) {
  const result = await db
    .delete(latePaymentFees)
    .where(and(eq(latePaymentFees.id, latePaymentFeeId), eq(latePaymentFees.businessId, businessId)))
    .returning({ id: latePaymentFees.id });
  return result.length > 0;
}