import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import db from '../db/index.js';
import { chartOfAccounts, contacts, journalEntryLines, projects } from '../db/schema.js';

type ProjectStatus = 'active' | 'inactive' | 'completed';

type Result<T> =
  | { result: T; error: null }
  | { result: null; error: 'INVALID_CUSTOMER' | 'NOT_FOUND' };

type Totals = { income: number; expenses: number } | undefined

// Income/Expenses proyek dihitung dari buku besar: baris jurnal yang bertag proyek.
async function computeTotals(projectIds: string[]): Promise<Map<string, { income: number; expenses: number }>> {
  const totals = new Map<string, { income: number; expenses: number }>()
  if (projectIds.length === 0) return totals

  const rows = await db
    .select({
      projectId: journalEntryLines.projectId,
      category: chartOfAccounts.category,
      debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
    .where(
      and(
        inArray(journalEntryLines.projectId, projectIds),
        inArray(chartOfAccounts.category, ['Income', 'Expense']),
      ),
    )
    .groupBy(journalEntryLines.projectId, chartOfAccounts.category)

  for (const r of rows) {
    if (!r.projectId) continue
    const entry = totals.get(r.projectId) ?? { income: 0, expenses: 0 }
    if (r.category === 'Income') entry.income += Number(r.credit) - Number(r.debit)
    else entry.expenses += Number(r.debit) - Number(r.credit)
    totals.set(r.projectId, entry)
  }
  return totals
}

function toResponseShape(row: typeof projects.$inferSelect, customerName: string | null, totals?: Totals) {
  return {
    id: row.id,
    businessId: row.businessId,
    code: row.code,
    name: row.name,
    customerId: row.customerId,
    customerName,
    status: row.status,
    totalIncome: totals?.income ?? 0,
    totalExpenses: totals?.expenses ?? 0,
    netProfit: (totals?.income ?? 0) - (totals?.expenses ?? 0),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Pelanggan proyek harus kontak is_customer = true, aktif, dan di bisnis yang sama.
async function customerIsValid(businessId: string, customerId: string): Promise<boolean> {
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

export async function listProjects(
  businessId: string,
  page: number,
  pageSize: number,
  filters: { search?: string; status?: ProjectStatus },
) {
  const conditions = [eq(projects.businessId, businessId)];
  if (filters.status) conditions.push(eq(projects.status, filters.status));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(projects.name, term), ilike(projects.code, term))!);
  }
  const whereClause = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(whereClause);

  const rows = await db
    .select({ project: projects, customerName: contacts.name })
    .from(projects)
    .leftJoin(contacts, eq(projects.customerId, contacts.id))
    .where(whereClause)
    .orderBy(projects.name, projects.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

    const totals = await computeTotals(rows.map((r) => r.project.id));
  return {
    data: rows.map((r) => toResponseShape(r.project, r.customerName, totals.get(r.project.id))),
    total: Number(count),
  };
}

export async function getProjectById(businessId: string, projectId: string) {
  const [row] = await db
    .select({ project: projects, customerName: contacts.name })
    .from(projects)
    .leftJoin(contacts, eq(projects.customerId, contacts.id))
    .where(and(eq(projects.id, projectId), eq(projects.businessId, businessId)))
    .limit(1);
    if (!row) return null;
  const totals = await computeTotals([row.project.id]);
  return toResponseShape(row.project, row.customerName, totals.get(row.project.id));
}

export async function createProject(
  businessId: string,
  data: { name: string; code?: string; customerId?: string; status: ProjectStatus },
): Promise<Result<NonNullable<Awaited<ReturnType<typeof getProjectById>>>>> {
  if (data.customerId && !(await customerIsValid(businessId, data.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' };
  }

  const [row] = await db
    .insert(projects)
    .values({
      businessId,
      name: data.name,
      code: data.code ? data.code : null,
      customerId: data.customerId ?? null,
      status: data.status,
    })
    .returning();

  const result = (await getProjectById(businessId, row.id))!;
  return { result, error: null };
}

export async function updateProject(
  businessId: string,
  projectId: string,
  data: { name?: string; code?: string | null; customerId?: string | null; status?: ProjectStatus },
): Promise<Result<NonNullable<Awaited<ReturnType<typeof getProjectById>>>>> {
  const existing = await getProjectById(businessId, projectId);
  if (!existing) return { result: null, error: 'NOT_FOUND' };

  if (data.customerId && !(await customerIsValid(businessId, data.customerId))) {
    return { result: null, error: 'INVALID_CUSTOMER' };
  }

  const changes: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) changes.name = data.name;
  if (data.code !== undefined) changes.code = data.code ? data.code : null;
  if (data.customerId !== undefined) changes.customerId = data.customerId;
  if (data.status !== undefined) changes.status = data.status;

  await db
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, projectId), eq(projects.businessId, businessId)));

  const result = (await getProjectById(businessId, projectId))!;
  return { result, error: null };
}

export async function setProjectStatus(businessId: string, projectId: string, status: ProjectStatus) {
  const [row] = await db
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.businessId, businessId)))
    .returning({ id: projects.id });
  return row ? getProjectById(businessId, projectId) : null;
}

// Tahap B: transaksi yang bertag proyek ini akan membuat database menolak
// penghapusan (foreign key), dan route menjawabnya 409.
export async function deleteProject(businessId: string, projectId: string) {
  const result = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.businessId, businessId)))
    .returning({ id: projects.id });
  return result.length > 0;
}