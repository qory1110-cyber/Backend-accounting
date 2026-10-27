import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import db from '../db/index.js';
import {
  expenseClaims,
  expenseClaimLines,
  expenseClaimPayers,
  paymentLines,
  chartOfAccounts,
  bankAccounts,
  journalEntries,
  journalEntryLines,
  projects,
} from '../db/schema.js';
import { findLockedUntil } from '../libs/period-lock.js';

const CLAIM_ACCOUNT_CODE = '2050';
const CLAIM_ACCOUNT_NAME = 'Utang Klaim Biaya';

// Akun liabilitas penampung klaim. Bisnis baru sudah dapat dari seed; bisnis lama
// dibuatkan otomatis saat klaim pertama (aman dipanggil berulang).
export async function ensureExpenseClaimAccount(
  businessId: string,
  client: Pick<typeof db, 'select' | 'insert'> = db,
) {
  const find = async () => {
    const [row] = await client
      .select()
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, CLAIM_ACCOUNT_CODE)))
      .limit(1);
    return row ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  await client
    .insert(chartOfAccounts)
    .values({ businessId, code: CLAIM_ACCOUNT_CODE, name: CLAIM_ACCOUNT_NAME, category: 'Liability' })
    .onConflictDoNothing();
  return (await find())!;
}

async function attachDetail(claim: typeof expenseClaims.$inferSelect, payerName: string) {
  const lines = await db
    .select({
      id: expenseClaimLines.id,
      accountId: expenseClaimLines.accountId,
      accountName: chartOfAccounts.name,
      description: expenseClaimLines.description,
      amount: expenseClaimLines.amount,
      projectId: expenseClaimLines.projectId,
      projectName: projects.name,
    })
    .from(expenseClaimLines)
    .innerJoin(chartOfAccounts, eq(expenseClaimLines.accountId, chartOfAccounts.id))
    .leftJoin(projects, eq(expenseClaimLines.projectId, projects.id))
    .where(eq(expenseClaimLines.expenseClaimId, claim.id))
    .orderBy(asc(expenseClaimLines.lineNo), asc(expenseClaimLines.id));

  const [paid] = await db
    .select({ total: sql<string>`COALESCE(SUM(${paymentLines.amount}), 0)` })
    .from(paymentLines)
    .where(eq(paymentLines.expenseClaimId, claim.id));

  const totalAmount = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const paidAmount = Number(paid.total);
  const balanceDue = totalAmount - paidAmount;

  return {
    id: claim.id,
    businessId: claim.businessId,
    claimDate: claim.claimDate,
    reference: claim.reference,
    payerId: claim.payerId,
    payerName,
    payee: claim.payee,
    description: claim.description,
    totalAmount,
    paidAmount,
    balanceDue,
    status: (balanceDue <= 0.01 ? 'Paid' : 'Unpaid') as 'Paid' | 'Unpaid',
    createdAt: claim.createdAt.toISOString(),
    lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
  };
}

export async function listExpenseClaims(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; payerId?: string; dateFrom?: string; dateTo?: string },
) {
  const conditions = [eq(expenseClaims.businessId, businessId)];
  if (filters.payerId) conditions.push(eq(expenseClaims.payerId, filters.payerId));
  if (filters.dateFrom) conditions.push(gte(expenseClaims.claimDate, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(expenseClaims.claimDate, filters.dateTo));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(expenseClaims.reference, term),
        ilike(expenseClaims.payee, term),
        ilike(expenseClaims.description, term),
        ilike(expenseClaimPayers.name, term),
      )!,
    );
  }
  const whereClause = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(expenseClaims)
    .innerJoin(expenseClaimPayers, eq(expenseClaims.payerId, expenseClaimPayers.id))
    .where(whereClause);

  const rows = await db
    .select({ claim: expenseClaims, payerName: expenseClaimPayers.name })
    .from(expenseClaims)
    .innerJoin(expenseClaimPayers, eq(expenseClaims.payerId, expenseClaimPayers.id))
    .where(whereClause)
    .orderBy(desc(expenseClaims.claimDate), desc(expenseClaims.createdAt), asc(expenseClaims.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map((r) => attachDetail(r.claim, r.payerName)));
  return { data, total: Number(count) };
}

export async function getExpenseClaimById(businessId: string, claimId: string) {
  const [row] = await db
    .select({ claim: expenseClaims, payerName: expenseClaimPayers.name })
    .from(expenseClaims)
    .innerJoin(expenseClaimPayers, eq(expenseClaims.payerId, expenseClaimPayers.id))
    .where(and(eq(expenseClaims.id, claimId), eq(expenseClaims.businessId, businessId)))
    .limit(1);
  return row ? attachDetail(row.claim, row.payerName) : null;
}

export async function createExpenseClaim(
  businessId: string,
  data: {
    claimDate: string;
    reference?: string;
    payerId: string;
    payee?: string;
    description?: string;
    lines: { accountId: string; projectId?: string; description?: string; amount: number }[];
  },
) {
  const [payer] = await db
    .select()
    .from(expenseClaimPayers)
    .where(and(eq(expenseClaimPayers.id, data.payerId), eq(expenseClaimPayers.businessId, businessId)))
    .limit(1);
  if (!payer) return { result: null, error: 'INVALID_PAYER' as const };
  if (!payer.isActive) return { result: null, error: 'INACTIVE_PAYER' as const };

  const lockedUntil = await findLockedUntil(businessId, [], data.claimDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  // Akun baris: harus milik bisnis ini, aktif, kategori Expense/Asset, bukan akun kontrol bank.
  const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
  const accounts = await db
    .select({ id: chartOfAccounts.id, category: chartOfAccounts.category, isActive: chartOfAccounts.isActive })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), inArray(chartOfAccounts.id, accountIds)));
  if (accounts.length !== accountIds.length) return { result: null, error: 'INVALID_ACCOUNT' as const };
  if (accounts.some((a) => !a.isActive || (a.category !== 'Expense' && a.category !== 'Asset'))) {
    return { result: null, error: 'INVALID_ACCOUNT' as const };
  }
  const bankControl = await db
    .select({ id: bankAccounts.controlAccountId })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.businessId, businessId), inArray(bankAccounts.controlAccountId, accountIds)));
    if (bankControl.length > 0) return { result: null, error: 'INVALID_ACCOUNT' as const };

  // Proyek baris: harus milik bisnis ini dan berstatus Active.
  const projectIds = [...new Set(data.lines.map((l) => l.projectId).filter((id): id is string => !!id))];
  if (projectIds.length > 0) {
    const found = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(and(eq(projects.businessId, businessId), inArray(projects.id, projectIds)));
    if (found.length !== projectIds.length) return { result: null, error: 'INVALID_PROJECT' as const };
    if (found.some((p) => p.status !== 'active')) return { result: null, error: 'INACTIVE_PROJECT' as const };
  }

  const totalCents = data.lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0);
  const total = (totalCents / 100).toFixed(2);

  let reference = data.reference?.trim();
  if (!reference) {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(expenseClaims)
      .where(eq(expenseClaims.businessId, businessId));
    reference = `EXP-${String(Number(count) + 1).padStart(4, '0')}`;
  }

  const claimId = await db.transaction(async (tx) => {
    const liability = await ensureExpenseClaimAccount(businessId, tx);

    const [journal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: data.claimDate,
        reference,
        sourceModule: 'expense_claim',
        description: data.description?.trim() || `Klaim biaya ${reference} - ${payer.name}`,
      })
      .returning();

    // Debit: satu baris per baris klaim.
    for (const l of data.lines) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: journal.id,
        accountId: l.accountId,
        projectId: l.projectId,
        debit: l.amount.toFixed(2),
        credit: '0.00',
        description: l.description,
      });
    }
    // Credit: total ke akun liabilitas, dengan kontak Payer.
    await tx.insert(journalEntryLines).values({
      journalEntryId: journal.id,
      accountId: liability.id,
      contactId: payer.contactId,
      debit: '0.00',
      credit: total,
    });

    const [claim] = await tx
      .insert(expenseClaims)
      .values({
        businessId,
        claimDate: data.claimDate,
        reference,
        payerId: data.payerId,
        payee: data.payee?.trim() || undefined,
        description: data.description?.trim() || undefined,
        journalEntryId: journal.id,
      })
      .returning();

    await tx.update(journalEntries).set({ sourceId: claim.id }).where(eq(journalEntries.id, journal.id));

    await tx.insert(expenseClaimLines).values(
      data.lines.map((l, i) => ({
        expenseClaimId: claim.id,
        lineNo: i + 1,
        accountId: l.accountId,
        projectId: l.projectId,
        description: l.description,
        amount: l.amount.toFixed(2),
      })),
    );

    return claim.id;
  });

  return { result: await getExpenseClaimById(businessId, claimId), error: null };
}

// Hapus = jurnal pembalik + hapus header. Ditolak kalau periode terkunci atau
// klaim sudah punya pembayaran (hapus Payment-nya dulu).
export async function deleteExpenseClaim(businessId: string, claimId: string) {
  const claim = await getExpenseClaimById(businessId, claimId);
  if (!claim) return { deleted: false, error: 'NOT_FOUND' as const };

  const lockedUntil = await findLockedUntil(businessId, [], claim.claimDate);
  if (lockedUntil) return { deleted: false, error: 'PERIOD_LOCKED' as const, lockedUntil };

  if (claim.paidAmount > 0) return { deleted: false, error: 'HAS_PAYMENTS' as const };

  const [row] = await db
    .select({ journalEntryId: expenseClaims.journalEntryId })
    .from(expenseClaims)
    .where(eq(expenseClaims.id, claimId))
    .limit(1);

  const originalLines = await db
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, row.journalEntryId));

  await db.transaction(async (tx) => {
    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        reference: claim.reference,
        sourceModule: 'expense_claim_void',
        sourceId: claim.id,
        description: `Pembalik klaim biaya ${claim.reference ?? ''}`.trim(),
      })
      .returning();

    for (const line of originalLines) {
      await tx.insert(journalEntryLines).values({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        contactId: line.contactId,
        projectId: line.projectId,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
      });
    }

    await tx.delete(expenseClaims).where(eq(expenseClaims.id, claimId));
  });

  return { deleted: true, error: null };
}