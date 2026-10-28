import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { salesQuotes, salesQuoteLines, contacts } from '../db/schema.js';

type LineInput = { description: string; qty: number; unitPrice: number };

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

// Expiry date = issueDate + validDays (format YYYY-MM-DD).
function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function attachComputedFields(quote: typeof salesQuotes.$inferSelect) {
  const lines = await db
    .select({
      id: salesQuoteLines.id,
      description: salesQuoteLines.description,
      qty: salesQuoteLines.qty,
      unitPrice: salesQuoteLines.unitPrice,
    })
    .from(salesQuoteLines)
    .where(eq(salesQuoteLines.salesQuoteId, quote.id))
    .orderBy(salesQuoteLines.lineNo);

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const [customer] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, quote.customerId))
    .limit(1);

  return {
    ...quote,
    customerName: customer?.name ?? '',
    expiryDate: quote.validDays !== null ? addDays(quote.issueDate, quote.validDays) : null,
    lines: linesOut,
    totalAmount,
  };
}

export async function listSalesQuotes(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(salesQuotes.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(salesQuotes.issueDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(salesQuotes.issueDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(salesQuotes.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(salesQuotes)
    .innerJoin(contacts, eq(salesQuotes.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(salesQuotes))
    .from(salesQuotes)
    .innerJoin(contacts, eq(salesQuotes.customerId, contacts.id))
    .where(where)
    .orderBy(desc(salesQuotes.issueDate), desc(salesQuotes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getSalesQuoteById(businessId: string, salesQuoteId: string) {
  const [row] = await db
    .select()
    .from(salesQuotes)
    .where(and(eq(salesQuotes.id, salesQuoteId), eq(salesQuotes.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createSalesQuote(
  businessId: string,
  data: {
    customerId: string;
    issueDate: string;
    validDays?: number;
    reference?: string;
    billingAddress?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }

  const id = await db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(salesQuotes)
      .values({ businessId, ...header } as typeof salesQuotes.$inferInsert)
      .returning();

    await tx.insert(salesQuoteLines).values(
      lines.map((l, i) => ({
        salesQuoteId: quote.id,
        lineNo: i,
        description: l.description,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return quote.id;
  });

  return { result: await getSalesQuoteById(businessId, id), error: null };
}

export async function updateSalesQuote(
  businessId: string,
  salesQuoteId: string,
  data: Partial<{
    customerId: string;
    issueDate: string;
    validDays: number | null;
    reference: string | null;
    billingAddress: string | null;
    description: string | null;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select({ id: salesQuotes.id })
    .from(salesQuotes)
    .where(and(eq(salesQuotes.id, salesQuoteId), eq(salesQuotes.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  const { lines, ...header } = data;

  if (header.customerId && !(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(salesQuotes).set(header).where(eq(salesQuotes.id, salesQuoteId));
    }
    if (lines) {
      await tx.delete(salesQuoteLines).where(eq(salesQuoteLines.salesQuoteId, salesQuoteId));
      await tx.insert(salesQuoteLines).values(
        lines.map((l, i) => ({
          salesQuoteId,
          lineNo: i,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getSalesQuoteById(businessId, salesQuoteId), error: null };
}

export async function deleteSalesQuote(businessId: string, salesQuoteId: string) {
  const [existing] = await db
    .select({ id: salesQuotes.id })
    .from(salesQuotes)
    .where(and(eq(salesQuotes.id, salesQuoteId), eq(salesQuotes.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false };

  await db.delete(salesQuotes).where(eq(salesQuotes.id, salesQuoteId));
  return { deleted: true };
}