import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import db from '../db/index.js';
import { chartOfAccounts, journalEntries, journalEntryLines, projects } from '../db/schema.js';
import { findLockedUntilForAccounts } from '../libs/period-lock.js';

const MANUAL_SOURCE = 'manual_journal';
const MANUAL_VOID_SOURCE = 'manual_journal_void';

type LineInput = { accountId: string; projectId?: string; debit: number; credit: number; description?: string };

const toCents = (n: number) => Math.round(n * 100);

// Jurnal manual yang belum dibalik. Jurnal pembalik (manual_journal_void) menunjuk
// ke jurnal asli lewat source_id, dan jurnal asli yang sudah dibalik dianggap "terhapus".
const notVoided = sql`NOT EXISTS (
  SELECT 1 FROM journal_entries v
  WHERE v.source_module = ${MANUAL_VOID_SOURCE} AND v.source_id = journal_entries.id
)`;

function searchCondition(search?: string) {
  if (!search) return undefined;
  const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    ilike(journalEntries.reference, term),
    ilike(journalEntries.description, term),
    sql`EXISTS (
      SELECT 1 FROM journal_entry_lines l
      JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = journal_entries.id
        AND (a.name ILIKE ${term} OR a.code ILIKE ${term})
    )`,
  );
}

function manualWhere(businessId: string, search?: string) {
  return and(
    eq(journalEntries.businessId, businessId),
    eq(journalEntries.sourceModule, MANUAL_SOURCE),
    notVoided,
    searchCondition(search),
  );
}

async function attachDetail(entry: typeof journalEntries.$inferSelect) {
  const rows = await db
    .select({
      id: journalEntryLines.id,
      accountId: journalEntryLines.accountId,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      description: journalEntryLines.description,
      projectId: journalEntryLines.projectId,
      projectName: projects.name,
    })
    .from(journalEntryLines)
    .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
    .leftJoin(projects, eq(journalEntryLines.projectId, projects.id))
    .where(eq(journalEntryLines.journalEntryId, entry.id))
    // Debit ditampilkan lebih dulu; tabel baris tidak menyimpan urutan input.
    .orderBy(sql`(${journalEntryLines.debit} > 0) DESC`, journalEntryLines.id);

  const lines = rows.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }));
  const totalDebit = lines.reduce((s, l) => s + toCents(l.debit), 0) / 100;
  const totalCredit = lines.reduce((s, l) => s + toCents(l.credit), 0) / 100;

  return {
    id: entry.id,
    businessId: entry.businessId,
    entryDate: entry.entryDate,
    reference: entry.reference,
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
    lines,
    totalDebit,
    totalCredit,
  };
}

export async function listJournalEntries(businessId: string, page: number, pageSize: number, search?: string) {
  const where = manualWhere(businessId, search);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(journalEntries)
    .where(where);

  const rows = await db
    .select()
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt), journalEntries.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = await Promise.all(rows.map(attachDetail));
  return { data, total: Number(count) };
}

export async function getJournalEntryById(businessId: string, id: string) {
  const [row] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), manualWhere(businessId)))
    .limit(1);
  return row ? attachDetail(row) : null;
}

// Proyek baris: harus milik bisnis ini dan berstatus Active.
async function validateProjects(businessId: string, projectIds: (string | null | undefined)[]) {
  const unique = [...new Set(projectIds.filter((id): id is string => !!id))];
  if (unique.length === 0) return null;
  const rows = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.businessId, businessId), inArray(projects.id, unique)));
  if (rows.length !== unique.length) return 'INVALID_PROJECT' as const;
  if (rows.some((p) => p.status !== 'active')) return 'INACTIVE_PROJECT' as const;
  return null;
}

// Jurnal manual langsung terposting (tidak ada draft). Tidak ada update:
// koreksi lewat Clone di UI lalu hapus jurnal yang salah (memposting jurnal pembalik).
export async function createJournalEntry(
  businessId: string,
  data: { entryDate: string; reference?: string; description?: string; lines: LineInput[] },
) {
  for (const l of data.lines) {
    const hasDebit = l.debit > 0;
    const hasCredit = l.credit > 0;
    if (hasDebit === hasCredit) return { result: null, error: 'INVALID_LINE_AMOUNT' as const };
  }

  const totalDebit = data.lines.reduce((s, l) => s + toCents(l.debit), 0);
  const totalCredit = data.lines.reduce((s, l) => s + toCents(l.credit), 0);
  if (totalDebit !== totalCredit) return { result: null, error: 'UNBALANCED' as const };

  const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
  const found = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.businessId, businessId),
        inArray(chartOfAccounts.id, accountIds),
        eq(chartOfAccounts.isActive, true),
        isNull(chartOfAccounts.deletedAt),
      ),
    );
  if (found.length !== accountIds.length) return { result: null, error: 'INVALID_ACCOUNT' as const };

  const projectError = await validateProjects(businessId, data.lines.map((l) => l.projectId));
  if (projectError) return { result: null, error: projectError };

  const lockedUntil = await findLockedUntilForAccounts(businessId, accountIds, data.entryDate);
  if (lockedUntil) return { result: null, error: 'PERIOD_LOCKED' as const, lockedUntil };

  const reference = data.reference?.trim() || `JV-${Date.now()}`;

  const id = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: data.entryDate,
        reference,
        sourceModule: MANUAL_SOURCE,
        description: data.description || null,
      })
      .returning();

    await tx.insert(journalEntryLines).values(
      data.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        projectId: l.projectId ?? null,
        description: l.description || null,
      })),
    );
    return entry.id;
  });

  return { result: await getJournalEntryById(businessId, id), error: null };
}

// "Hapus" = memposting jurnal pembalik bertanggal hari ini. Jurnal asli tetap ada
// di ledger, tetapi hilang dari daftar karena sudah punya pembalik.
export async function deleteJournalEntry(businessId: string, id: string) {
  const entry = await getJournalEntryById(businessId, id);
  if (!entry) return { deleted: false, lockedUntil: null };

  const lockedUntil = await findLockedUntilForAccounts(
    businessId,
    [...new Set(entry.lines.map((l) => l.accountId))],
    entry.entryDate,
  );
  if (lockedUntil) return { deleted: false, lockedUntil };

  const done = await db.transaction(async (tx) => {
    // Kunci baris asli supaya dua penghapusan bersamaan tidak membuat dua pembalik.
    await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.id, entry.id)).for('update');

    const [already] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.sourceModule, MANUAL_VOID_SOURCE), eq(journalEntries.sourceId, entry.id)))
      .limit(1);
    if (already) return false;

    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        businessId,
        entryDate: new Date().toISOString().slice(0, 10),
        reference: entry.reference,
        sourceModule: MANUAL_VOID_SOURCE,
        sourceId: entry.id,
        description: `Pembalik jurnal ${entry.reference ?? ''}`.trim(),
      })
      .returning();

    await tx.insert(journalEntryLines).values(
      entry.lines.map((l) => ({
        journalEntryId: reversal.id,
        accountId: l.accountId,
        debit: l.credit.toFixed(2),
        credit: l.debit.toFixed(2),
        projectId: l.projectId,
        description: l.description,
      })),
    );
    return true;
  });

  return { deleted: done, lockedUntil: null };
}