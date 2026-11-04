import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { deliveryNotes, deliveryNoteLines, contacts, salesOrders, salesInvoices } from '../db/schema.js';

type LineInput = { description: string; qty: number };

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

// Order number / Invoice number harus ada di bisnis ini dan milik pelanggan yang sama.
async function checkRefs(
  businessId: string,
  customerId: string,
  salesOrderId: string | null | undefined,
  salesInvoiceId: string | null | undefined,
) {
  if (salesOrderId) {
    const [o] = await db
      .select({ customerId: salesOrders.customerId })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.businessId, businessId)))
      .limit(1);
    if (!o) return 'INVALID_ORDER' as const;
    if (o.customerId !== customerId) return 'ORDER_CUSTOMER_MISMATCH' as const;
  }
  if (salesInvoiceId) {
    const [inv] = await db
      .select({ customerId: salesInvoices.customerId })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.businessId, businessId)))
      .limit(1);
    if (!inv) return 'INVALID_INVOICE' as const;
    if (inv.customerId !== customerId) return 'INVOICE_CUSTOMER_MISMATCH' as const;
  }
  return null;
}

async function attachComputedFields(note: typeof deliveryNotes.$inferSelect) {
  const lines = await db
    .select({
      id: deliveryNoteLines.id,
      description: deliveryNoteLines.description,
      qty: deliveryNoteLines.qty,
    })
    .from(deliveryNoteLines)
    .where(eq(deliveryNoteLines.deliveryNoteId, note.id))
    .orderBy(deliveryNoteLines.lineNo);

  const [customer] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, note.customerId))
    .limit(1);

  let salesOrderReference: string | null = null;
  if (note.salesOrderId) {
    const [o] = await db
      .select({ reference: salesOrders.reference })
      .from(salesOrders)
      .where(eq(salesOrders.id, note.salesOrderId))
      .limit(1);
    salesOrderReference = o?.reference ?? null;
  }

  let salesInvoiceReference: string | null = null;
  if (note.salesInvoiceId) {
    const [inv] = await db
      .select({ reference: salesInvoices.reference })
      .from(salesInvoices)
      .where(eq(salesInvoices.id, note.salesInvoiceId))
      .limit(1);
    salesInvoiceReference = inv?.reference ?? null;
  }

  return {
    ...note,
    customerName: customer?.name ?? '',
    salesOrderReference,
    salesInvoiceReference,
    lines,
  };
}

export async function listDeliveryNotes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(deliveryNotes.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(deliveryNotes.deliveryDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(deliveryNotes.deliveryDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(deliveryNotes.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(deliveryNotes)
    .innerJoin(contacts, eq(deliveryNotes.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(deliveryNotes))
    .from(deliveryNotes)
    .innerJoin(contacts, eq(deliveryNotes.customerId, contacts.id))
    .where(where)
    .orderBy(desc(deliveryNotes.deliveryDate), desc(deliveryNotes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getDeliveryNoteById(businessId: string, deliveryNoteId: string) {
  const [row] = await db
    .select()
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryNoteId), eq(deliveryNotes.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createDeliveryNote(
  businessId: string,
  data: {
    customerId: string;
    deliveryDate: string;
    reference?: string;
    salesOrderId?: string;
    salesInvoiceId?: string;
    deliveryAddress?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }
  const refError = await checkRefs(businessId, header.customerId, header.salesOrderId, header.salesInvoiceId);
  if (refError) return { result: null, error: refError };

  const id = await db.transaction(async (tx) => {
    const [note] = await tx
      .insert(deliveryNotes)
      .values({ businessId, ...header } as typeof deliveryNotes.$inferInsert)
      .returning();

    await tx.insert(deliveryNoteLines).values(
      lines.map((l, i) => ({
        deliveryNoteId: note.id,
        lineNo: i,
        description: l.description,
        qty: l.qty.toString(),
      })),
    );
    return note.id;
  });

  return { result: await getDeliveryNoteById(businessId, id), error: null };
}

export async function updateDeliveryNote(
  businessId: string,
  deliveryNoteId: string,
  data: Partial<{
    customerId: string;
    deliveryDate: string;
    reference: string | null;
    salesOrderId: string | null;
    salesInvoiceId: string | null;
    deliveryAddress: string | null;
    description: string | null;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select()
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryNoteId), eq(deliveryNotes.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  const { lines, ...header } = data;

  if (header.customerId && !(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }

  // Bila pelanggan/order/faktur disentuh, validasi ulang pasangannya dengan nilai tersimpan untuk yang tidak dikirim.
  if (
    header.customerId !== undefined ||
    header.salesOrderId !== undefined ||
    header.salesInvoiceId !== undefined
  ) {
    const refError = await checkRefs(
      businessId,
      header.customerId ?? existing.customerId,
      header.salesOrderId !== undefined ? header.salesOrderId : existing.salesOrderId,
      header.salesInvoiceId !== undefined ? header.salesInvoiceId : existing.salesInvoiceId,
    );
    if (refError) return { result: null, error: refError };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(deliveryNotes).set(header).where(eq(deliveryNotes.id, deliveryNoteId));
    }
    if (lines) {
      await tx.delete(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, deliveryNoteId));
      await tx.insert(deliveryNoteLines).values(
        lines.map((l, i) => ({
          deliveryNoteId,
          lineNo: i,
          description: l.description,
          qty: l.qty.toString(),
        })),
      );
    }
  });

  return { result: await getDeliveryNoteById(businessId, deliveryNoteId), error: null };
}

export async function deleteDeliveryNote(businessId: string, deliveryNoteId: string) {
  const [existing] = await db
    .select({ id: deliveryNotes.id })
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryNoteId), eq(deliveryNotes.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false };

  await db.delete(deliveryNotes).where(eq(deliveryNotes.id, deliveryNoteId));
  return { deleted: true };
}