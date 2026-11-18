import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '../db/index.js';
import { goodsReceipts, goodsReceiptLines, contacts, purchaseOrders, purchaseInvoices } from '../db/schema.js';

type LineInput = { description: string; qty: number };

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

// Order number / Invoice number harus ada di bisnis ini dan milik supplier yang sama.
async function checkRefs(
  businessId: string,
  supplierId: string,
  purchaseOrderId: string | null | undefined,
  purchaseInvoiceId: string | null | undefined,
) {
  if (purchaseOrderId) {
    const [o] = await db
      .select({ supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.businessId, businessId)))
      .limit(1);
    if (!o) return 'INVALID_ORDER' as const;
    if (o.supplierId !== supplierId) return 'ORDER_SUPPLIER_MISMATCH' as const;
  }
  if (purchaseInvoiceId) {
    const [inv] = await db
      .select({ supplierId: purchaseInvoices.supplierId })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.businessId, businessId)))
      .limit(1);
    if (!inv) return 'INVALID_INVOICE' as const;
    if (inv.supplierId !== supplierId) return 'INVOICE_SUPPLIER_MISMATCH' as const;
  }
  return null;
}

async function attachComputedFields(receipt: typeof goodsReceipts.$inferSelect) {
  const lines = await db
    .select({
      id: goodsReceiptLines.id,
      description: goodsReceiptLines.description,
      qty: goodsReceiptLines.qty,
    })
    .from(goodsReceiptLines)
    .where(eq(goodsReceiptLines.goodsReceiptId, receipt.id))
    .orderBy(goodsReceiptLines.lineNo);

  const [supplier] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, receipt.supplierId))
    .limit(1);

  let purchaseOrderReference: string | null = null;
  if (receipt.purchaseOrderId) {
    const [o] = await db
      .select({ reference: purchaseOrders.reference })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, receipt.purchaseOrderId))
      .limit(1);
    purchaseOrderReference = o?.reference ?? null;
  }

  let purchaseInvoiceReference: string | null = null;
  if (receipt.purchaseInvoiceId) {
    const [inv] = await db
      .select({ reference: purchaseInvoices.reference })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.id, receipt.purchaseInvoiceId))
      .limit(1);
    purchaseInvoiceReference = inv?.reference ?? null;
  }

  const totalQty = Math.round(lines.reduce((sum, l) => sum + Number(l.qty), 0) * 100) / 100;

  return {
    ...receipt,
    supplierName: supplier?.name ?? '',
    purchaseOrderReference,
    purchaseInvoiceReference,
    totalQty,
    lines,
  };
}

export async function listGoodsReceipts(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; dateFrom?: string; dateTo?: string } = {},
) {
  const conds: SQL[] = [eq(goodsReceipts.businessId, businessId)];
  if (filters.dateFrom) conds.push(gte(goodsReceipts.receiptDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(goodsReceipts.receiptDate, filters.dateTo));
  if (filters.search && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conds.push(or(ilike(goodsReceipts.reference, pattern), ilike(contacts.name, pattern))!);
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(goodsReceipts)
    .innerJoin(contacts, eq(goodsReceipts.supplierId, contacts.id))
    .where(where);

  const rows = await db
    .select(getTableColumns(goodsReceipts))
    .from(goodsReceipts)
    .innerJoin(contacts, eq(goodsReceipts.supplierId, contacts.id))
    .where(where)
    .orderBy(desc(goodsReceipts.receiptDate), desc(goodsReceipts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachComputedFields));
  return { data, total: Number(count) };
}

export async function getGoodsReceiptById(businessId: string, goodsReceiptId: string) {
  const [row] = await db
    .select()
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, goodsReceiptId), eq(goodsReceipts.businessId, businessId)))
    .limit(1);
  return row ? attachComputedFields(row) : null;
}

export async function createGoodsReceipt(
  businessId: string,
  data: {
    supplierId: string;
    receiptDate: string;
    reference?: string;
    purchaseOrderId?: string;
    purchaseInvoiceId?: string;
    description?: string;
    lines: LineInput[];
  },
) {
  const { lines, ...header } = data;

  if (!(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }
  const refError = await checkRefs(businessId, header.supplierId, header.purchaseOrderId, header.purchaseInvoiceId);
  if (refError) return { result: null, error: refError };

  const id = await db.transaction(async (tx) => {
    const [receipt] = await tx
      .insert(goodsReceipts)
      .values({ businessId, ...header } as typeof goodsReceipts.$inferInsert)
      .returning();

    await tx.insert(goodsReceiptLines).values(
      lines.map((l, i) => ({
        goodsReceiptId: receipt.id,
        lineNo: i,
        description: l.description,
        qty: l.qty.toString(),
      })),
    );
    return receipt.id;
  });

  return { result: await getGoodsReceiptById(businessId, id), error: null };
}

export async function updateGoodsReceipt(
  businessId: string,
  goodsReceiptId: string,
  data: Partial<{
    supplierId: string;
    receiptDate: string;
    reference: string | null;
    purchaseOrderId: string | null;
    purchaseInvoiceId: string | null;
    description: string | null;
    lines: LineInput[];
  }>,
) {
  const [existing] = await db
    .select()
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, goodsReceiptId), eq(goodsReceipts.businessId, businessId)))
    .limit(1);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };

  const { lines, ...header } = data;

  if (header.supplierId && !(await isValidSupplier(businessId, header.supplierId))) {
    return { result: null, error: 'INVALID_SUPPLIER' as const };
  }

  // Bila supplier/order/faktur disentuh, validasi ulang pasangannya dengan nilai tersimpan untuk yang tidak dikirim.
  if (
    header.supplierId !== undefined ||
    header.purchaseOrderId !== undefined ||
    header.purchaseInvoiceId !== undefined
  ) {
    const refError = await checkRefs(
      businessId,
      header.supplierId ?? existing.supplierId,
      header.purchaseOrderId !== undefined ? header.purchaseOrderId : existing.purchaseOrderId,
      header.purchaseInvoiceId !== undefined ? header.purchaseInvoiceId : existing.purchaseInvoiceId,
    );
    if (refError) return { result: null, error: refError };
  }

  await db.transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.update(goodsReceipts).set(header).where(eq(goodsReceipts.id, goodsReceiptId));
    }
    if (lines) {
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, goodsReceiptId));
      await tx.insert(goodsReceiptLines).values(
        lines.map((l, i) => ({
          goodsReceiptId,
          lineNo: i,
          description: l.description,
          qty: l.qty.toString(),
        })),
      );
    }
  });

  return { result: await getGoodsReceiptById(businessId, goodsReceiptId), error: null };
}

export async function deleteGoodsReceipt(businessId: string, goodsReceiptId: string) {
  const [existing] = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, goodsReceiptId), eq(goodsReceipts.businessId, businessId)))
    .limit(1);

  if (!existing) return { deleted: false };

  await db.delete(goodsReceipts).where(eq(goodsReceipts.id, goodsReceiptId));
  return { deleted: true };
}