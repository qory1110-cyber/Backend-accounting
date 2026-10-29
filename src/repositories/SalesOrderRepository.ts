import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { salesOrders, salesOrderLines, contacts } from '../db/schema.js';

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

async function attachComputedFields(order: typeof salesOrders.$inferSelect) {
  const lines = await db
    .select({
      id: salesOrderLines.id,
      description: salesOrderLines.description,
      qty: salesOrderLines.qty,
      unitPrice: salesOrderLines.unitPrice,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, order.id))
    .orderBy(salesOrderLines.lineNo);

  const linesOut = lines.map((l) => ({
    ...l,
    subtotal: Number(l.qty) * Number(l.unitPrice),
  }));
  const totalAmount = linesOut.reduce((sum, l) => sum + l.subtotal, 0);

  const [customer] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, order.customerId))
    .limit(1);

  return {
    ...order,
    customerName: customer?.name ?? '',
    lines: linesOut,
    totalAmount,
  };
}

export async function listSalesOrders(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(salesOrders.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(salesOrders.issueDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(salesOrders.issueDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(salesOrders.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(salesOrders)
    .innerJoin(contacts, eq(salesOrders.customerId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(salesOrders))
    .from(salesOrders)
    .innerJoin(contacts, eq(salesOrders.customerId, contacts.id))
    .where(where)
    .orderBy(desc(salesOrders.issueDate), desc(salesOrders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getSalesOrderById(businessId: string, salesOrderId: string) {
  const [row] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createSalesOrder(
  businessId: string,
  data: {
    customerId: string;
    issueDate: string;
    reference?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }

  const id = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(salesOrders)
      .values({ businessId, ...header } as typeof salesOrders.$inferInsert)
      .returning();

    await tx.insert(salesOrderLines).values(
      lines.map((l, i) => ({
        salesOrderId: order.id,
        lineNo: i,
        description: l.description,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
    );
    return order.id;
  });

  return { result: await getSalesOrderById(businessId, id), error: null };
}

export async function updateSalesOrder(
  businessId: string,
  salesOrderId: string,
  data: Partial<{
    customerId: string;
    issueDate: string;
    reference: string | null;
    description: string | null;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  const { lines, ...header } = data;

  if (header.customerId && !(await isValidCustomer(businessId, header.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' as const };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(salesOrders).set(header).where(eq(salesOrders.id, salesOrderId));
    }
    if (lines) {
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, salesOrderId));
      await tx.insert(salesOrderLines).values(
        lines.map((l, i) => ({
          salesOrderId,
          lineNo: i,
          description: l.description,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
        })),
      );
    }
  });

  return { result: await getSalesOrderById(businessId, salesOrderId), error: null };
}

export async function deleteSalesOrder(businessId: string, salesOrderId: string) {
  const [existing] = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false };

  await db.delete(salesOrders).where(eq(salesOrders.id, salesOrderId));
  return { deleted: true };
}