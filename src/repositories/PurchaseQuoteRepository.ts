import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { purchaseQuotes, purchaseQuoteLines, contacts } from '../db/schema.js';

type LineInput = { description: string; qty: number; unitPrice: number };

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

async function attachComputedFields(quote: typeof purchaseQuotes.$inferSelect) {
  const lines = await db
    .select({
      id: purchaseQuoteLines.id,
      description: purchaseQuoteLines.description,
      qty: purchaseQuoteLines.qty,
      unitPrice: purchaseQuoteLines.unitPrice,
    })
    .from(purchaseQuoteLines)
    .where(eq(purchaseQuoteLines.purchaseQuoteId, quote.id))
    .orderBy(purchaseQuoteLines.lineNo);

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const [supplier] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, quote.supplierId))
    .limit(1);

  return {
    ...quote,
    supplierName: supplier?.name ?? '',
    lines: linesOut,
    totalAmount,
  };
}

export async function listPurchaseQuotes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: {
    search?: string;
    status?: 'active' | 'cancelled';
    supplierId?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {},
) {
  const conds: SQL[] = [eq(purchaseQuotes.businessId, businessId)];
  if (filters.status) conds.push(eq(purchaseQuotes.status, filters.status));
  if (filters.supplierId) conds.push(eq(purchaseQuotes.supplierId, filters.supplierId));
  if (filters.dateFrom) conds.push(gte(purchaseQuotes.issueDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(purchaseQuotes.issueDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(
      or(
        ilike(purchaseQuotes.reference, pattern),
        ilike(purchaseQuotes.description, pattern),
        ilike(contacts.name, pattern),
      )!,
    );
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(purchaseQuotes)
    .innerJoin(contacts, eq(purchaseQuotes.supplierId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(purchaseQuotes))
    .from(purchaseQuotes)
    .innerJoin(contacts, eq(purchaseQuotes.supplierId, contacts.id))
    .where(where)
    .orderBy(desc(purchaseQuotes.issueDate), desc(purchaseQuotes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getPurchaseQuoteById(businessId: string, purchaseQuoteId: string) {
  const [row] = await db
    .select()
    .from(purchaseQuotes)
    .where(and(eq(purchaseQuotes.id, purchaseQuoteId), eq(purchaseQuotes.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createPurchaseQuote(
  businessId: string,
  data: {
    supplierId: string;
    issueDate: string;
    reference?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }

  const id = await db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(purchaseQuotes)
      .values({ businessId, ...header } as typeof purchaseQuotes.$inferInsert)
      .returning();

    await tx.insert(purchaseQuoteLines).values(
      lines.map((l, i) => ({
        purchaseQuoteId: quote.id,
        lineNo: i,
        description: l.description,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return quote.id;
  });

  return { result: await getPurchaseQuoteById(businessId, id), error: null };
}

// Edit hanya untuk penawaran Active. status 'cancelled' membatalkan penawaran.
export async function updatePurchaseQuote(
  businessId: string,
  purchaseQuoteId: string,
  data: Partial<{
    supplierId: string;
    issueDate: string;
    reference: string | null;
    description: string | null;
    lines: LineInput[];
    status: 'cancelled';
  }>,
) {
  const [existing] = await db
    .select({ id: purchaseQuotes.id, status: purchaseQuotes.status })
    .from(purchaseQuotes)
    .where(and(eq(purchaseQuotes.id, purchaseQuoteId), eq(purchaseQuotes.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };
  if (existing.status !== 'active') return { result: null, error: 'NOT_EDITABLE' as const };

  const { lines, ...header } = data;

  if (header.supplierId && !(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(purchaseQuotes)
      .set({ ...header, updatedAt: new Date() })
      .where(eq(purchaseQuotes.id, purchaseQuoteId));

    if (lines) {
      await tx.delete(purchaseQuoteLines).where(eq(purchaseQuoteLines.purchaseQuoteId, purchaseQuoteId));
      await tx.insert(purchaseQuoteLines).values(
        lines.map((l, i) => ({
          purchaseQuoteId,
          lineNo: i,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getPurchaseQuoteById(businessId, purchaseQuoteId), error: null };
}

export async function deletePurchaseQuote(businessId: string, purchaseQuoteId: string) {
  const [existing] = await db
    .select({ id: purchaseQuotes.id })
    .from(purchaseQuotes)
    .where(and(eq(purchaseQuotes.id, purchaseQuoteId), eq(purchaseQuotes.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false };

  await db.delete(purchaseQuotes).where(eq(purchaseQuotes.id, purchaseQuoteId));
  return { deleted: true };
}