import { and, eq, asc, sql } from 'drizzle-orm';
import db from '../db/index.js';
import { contacts, expenseClaimPayers } from '../db/schema.js';

function toResponseShape(row: typeof expenseClaimPayers.$inferSelect) {
  return {
    id: row.id,
    businessId: row.businessId,
    contactId: row.contactId,
    name: row.name,
    isActive: row.isActive,
  };
}

async function nameExists(businessId: string, name: string, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: expenseClaimPayers.id })
    .from(expenseClaimPayers)
    .where(
      and(
        eq(expenseClaimPayers.businessId, businessId),
        sql`lower(${expenseClaimPayers.name}) = ${name.toLowerCase()}`,
      ),
    );
  return rows.some((r) => r.id !== excludeId);
}

export async function listPayers(businessId: string) {
  const rows = await db
    .select()
    .from(expenseClaimPayers)
    .where(eq(expenseClaimPayers.businessId, businessId))
    .orderBy(asc(expenseClaimPayers.name), asc(expenseClaimPayers.id));
  return rows.map(toResponseShape);
}

export async function getPayerById(businessId: string, payerId: string) {
  const [row] = await db
    .select()
    .from(expenseClaimPayers)
    .where(and(eq(expenseClaimPayers.id, payerId), eq(expenseClaimPayers.businessId, businessId)))
    .limit(1);
  return row ? toResponseShape(row) : null;
}

export async function createPayer(businessId: string, data: { name: string }) {
  const name = data.name.trim();
  if (await nameExists(businessId, name)) {
    return { result: null, error: 'DUPLICATE_NAME' as const };
  }
  const row = await db.transaction(async (tx) => {
    // Kontak tersembunyi: bukan customer & bukan supplier
    const [contact] = await tx
      .insert(contacts)
      .values({ businessId, name, isCustomer: false, isSupplier: false })
      .returning();
    const [payer] = await tx
      .insert(expenseClaimPayers)
      .values({ businessId, contactId: contact.id, name })
      .returning();
    return payer;
  });
  return { result: toResponseShape(row), error: null };
}

export async function updatePayer(businessId: string, payerId: string, data: { name: string }) {
  const name = data.name.trim();
  const existing = await getPayerById(businessId, payerId);
  if (!existing) return { result: null, error: 'NOT_FOUND' as const };
  if (await nameExists(businessId, name, payerId)) {
    return { result: null, error: 'DUPLICATE_NAME' as const };
  }
  const row = await db.transaction(async (tx) => {
    const [payer] = await tx
      .update(expenseClaimPayers)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(expenseClaimPayers.id, payerId), eq(expenseClaimPayers.businessId, businessId)))
      .returning();
    await tx
      .update(contacts)
      .set({ name, updatedAt: new Date() })
      .where(eq(contacts.id, payer.contactId));
    return payer;
  });
  return { result: toResponseShape(row), error: null };
}

export async function setPayerActive(businessId: string, payerId: string, isActive: boolean) {
  const row = await db.transaction(async (tx) => {
    const [payer] = await tx
      .update(expenseClaimPayers)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(expenseClaimPayers.id, payerId), eq(expenseClaimPayers.businessId, businessId)))
      .returning();
    if (!payer) return null;
    await tx
      .update(contacts)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(contacts.id, payer.contactId));
    return payer;
  });
  return row ? toResponseShape(row) : null;
}

// Hapus Payer + kontak tersembunyinya. Kalau sudah punya riwayat (klaim/jurnal),
// FK melempar error dan transaksi dibatalkan semua -> route memetakan ke 409.
export async function deletePayer(businessId: string, payerId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(expenseClaimPayers)
      .where(and(eq(expenseClaimPayers.id, payerId), eq(expenseClaimPayers.businessId, businessId)))
      .returning({ contactId: expenseClaimPayers.contactId });
    if (deleted.length === 0) return false;
    await tx.delete(contacts).where(eq(contacts.id, deleted[0].contactId));
    return true;
  });
}