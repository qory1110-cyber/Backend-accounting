import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseInvoices,
  purchaseInvoiceLines,
  chartOfAccounts,
  contacts,
} from '../db/schema.js';

type LineInput = { accountId: string; description?: string; qty: number; unitPrice: number };

// Supplier harus is_supplier, aktif, dan milik bisnis ini.
async function isValidSupplier(businessId: string, supplierId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, supplierId),
        eq(contacts.businessId, businessId),
        eq(contacts.isSupplier, true),
        eq(contacts.isActive, true),
      ),
    )
    .limit(1);
  return !!row;
}

// Semua akun baris harus milik bisnis ini dan berkategori Expense.
async function areValidExpenseAccounts(businessId: string, accountIds: string[]) {
  const unique = [...new Set(accountIds)];
  const rows = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        inArray(chartOfAccounts.id, unique),
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.category, 'Expense'),
      ),
    );
  return rows.length === unique.length;
}

// Ada faktur (status apa pun) yang menaut ke PO ini?
async function hasLinkedInvoices(purchaseOrderId: string) {
  const [row] = await db
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.purchaseOrderId, purchaseOrderId))
    .limit(1);
  return !!row;
}

async function attachComputedFields(order: typeof purchaseOrders.$inferSelect) {
  const lines = await db
    .select({
      id: purchaseOrderLines.id,
      accountId: purchaseOrderLines.accountId,
      accountName: chartOfAccounts.name,
      description: purchaseOrderLines.description,
      qty: purchaseOrderLines.qty,
      unitPrice: purchaseOrderLines.unitPrice,
    })
    .from(purchaseOrderLines)
    .innerJoin(chartOfAccounts, eq(purchaseOrderLines.accountId, chartOfAccounts.id))
    .where(eq(purchaseOrderLines.purchaseOrderId, order.id))
    .orderBy(purchaseOrderLines.lineNo);

  // Qty yang sudah ditagih per baris PO: hanya dari faktur berstatus approved.
  const invoicedByLine = new Map<string, number>();
  if (lines.length > 0) {
    const invoicedRows = await db
      .select({
        lineId: purchaseInvoiceLines.purchaseOrderLineId,
        total: sql<string>`COALESCE(SUM(${purchaseInvoiceLines.qty}), 0)`,
      })
      .from(purchaseInvoiceLines)
      .innerJoin(purchaseInvoices, eq(purchaseInvoiceLines.purchaseInvoiceId, purchaseInvoices.id))
      .where(
        and(
          inArray(purchaseInvoiceLines.purchaseOrderLineId, lines.map((l) => l.id)),
          eq(purchaseInvoices.status, 'approved'),
        ),
      )
      .groupBy(purchaseInvoiceLines.purchaseOrderLineId);
    for (const r of invoicedRows) {
      if (r.lineId) invoicedByLine.set(r.lineId, Number(r.total));
    }
  }

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
    qtyInvoiced: invoicedByLine.get(l.id) ?? 0,
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const anyInvoiced = linesOut.some((l) => l.qtyInvoiced > 0);
  const allInvoiced = linesOut.length > 0 && linesOut.every((l) => l.qtyInvoiced >= Number(l.qty));
  const status = allInvoiced ? ('Invoiced' as const) : anyInvoiced ? ('Partially Invoiced' as const) : ('Unbilled' as const);

  const [supplier] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, order.supplierId))
    .limit(1);

  return {
    ...order,
    supplierName: supplier?.name ?? '',
    lines: linesOut,
    totalAmount,
    status,
    hasInvoices: await hasLinkedInvoices(order.id),
  };
}

export async function listPurchaseOrders(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(purchaseOrders.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(purchaseOrders.orderDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(purchaseOrders.orderDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(purchaseOrders.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(purchaseOrders)
    .innerJoin(contacts, eq(purchaseOrders.supplierId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(purchaseOrders))
    .from(purchaseOrders)
    .innerJoin(contacts, eq(purchaseOrders.supplierId, contacts.id))
    .where(where)
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getPurchaseOrderById(businessId: string, purchaseOrderId: string) {
  const [row] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createPurchaseOrder(
  businessId: string,
  data: {
    supplierId: string;
    orderDate: string;
    reference?: string;
    billingAddress?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }
  if (!(await areValidExpenseAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  const id = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(purchaseOrders)
      .values({ businessId, ...header } as typeof purchaseOrders.$inferInsert)
      .returning();

    await tx.insert(purchaseOrderLines).values(
      lines.map((l, i) => ({
        purchaseOrderId: order.id,
        lineNo: i,
        accountId: l.accountId,
        description: l.description,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return order.id;
  });

  return { result: await getPurchaseOrderById(businessId, id), error: null };
}

export async function updatePurchaseOrder(
  businessId: string,
  purchaseOrderId: string,
  data: Partial<{
    supplierId: string;
    orderDate: string;
    reference: string;
    billingAddress: string;
    description: string;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  const { lines, ...header } = data;

  // PO yang sudah punya faktur: rincian dan supplier dikunci agar penaut baris faktur tidak putus.
  if ((lines !== undefined || header.supplierId !== undefined) && (await hasLinkedInvoices(purchaseOrderId))) {
    return { result: null, error: 'HAS_INVOICES' as const };
  }

  if (header.supplierId && !(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }
  if (lines && !(await areValidExpenseAccounts(businessId, lines.map((l) => l.accountId)))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(purchaseOrders).set(header).where(eq(purchaseOrders.id, purchaseOrderId));
    }
    if (lines) {
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
        await tx.insert(purchaseOrderLines).values(
        lines.map((l, i) => ({
          purchaseOrderId,
          lineNo: i,
          accountId: l.accountId,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getPurchaseOrderById(businessId, purchaseOrderId), error: null };
}

export async function deletePurchaseOrder(businessId: string, purchaseOrderId: string) {
  const [existing] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false, blocked: false };
  if (await hasLinkedInvoices(purchaseOrderId)) return { deleted: false, blocked: true };

  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId));
  return { deleted: true, blocked: false };
}