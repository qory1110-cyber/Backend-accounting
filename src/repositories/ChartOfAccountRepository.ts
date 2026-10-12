import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import db from '../db/index.js';
import { chartOfAccounts } from '../db/schema.js';

// Sama seperti seluruh repository lain (§2.4 LAPORAN_FASE_1_2_Backend.docx):
// businessId WAJIB eksplisit di tiap fungsi, tidak pernah query by-id saja.

export async function listChartOfAccounts(businessId: string, page: number, pageSize: number, category?: string) {
  const conditions = [eq(chartOfAccounts.businessId, businessId)];
  if (category) conditions.push(eq(chartOfAccounts.category, category as (typeof chartOfAccounts.category.enumValues)[number]));
  const whereClause = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chartOfAccounts)
    .where(whereClause);

  // Urut kategori (sesuai urutan enum: Asset, Liability, Equity, Income, Expense),
  // lalu kode. Kode unik per bisnis, jadi urutannya pasti.
  const data = await db
    .select()
    .from(chartOfAccounts)
    .where(whereClause)
    .orderBy(chartOfAccounts.category, chartOfAccounts.code)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data, total: Number(count) };
}

// Untuk dropdown pencarian: ringan, diurutkan dari yang TERAKHIR DIUBAH,
// dengan filter kategori opsional (Income untuk faktur penjualan, dst).
export async function listRecentChartOfAccounts(businessId: string, limit: number, category?: string) {
  const conditions = [eq(chartOfAccounts.businessId, businessId)];
  if (category) {
    conditions.push(eq(chartOfAccounts.category, category as (typeof chartOfAccounts.category.enumValues)[number]));
  }
  return db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      category: chartOfAccounts.category,
      isActive: chartOfAccounts.isActive,
    })
    .from(chartOfAccounts)
    .where(and(...conditions))
    .orderBy(desc(chartOfAccounts.updatedAt), chartOfAccounts.code)
    .limit(limit);
}

export async function getChartOfAccountById(businessId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.id, accountId),
        eq(chartOfAccounts.businessId, businessId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createChartOfAccount(
  businessId: string,
  data: {
    code: string;
    name: string;
    category: string;
    groupName?: string;
    currencyCode?: string;
    isControlAccount?: boolean;
  },
) {
  const [row] = await db
    .insert(chartOfAccounts)
    .values({ businessId, ...data } as typeof chartOfAccounts.$inferInsert)
    .returning();
  return row;
}

export async function updateChartOfAccount(
  businessId: string,
  accountId: string,
  data: Partial<{
    code: string;
    name: string;
    category: string;
    groupName: string;
    currencyCode: string;
    isControlAccount: boolean;
  }>,
) {
  const [row] = await db
    .update(chartOfAccounts)
        .set({ ...data, updatedAt: new Date() } as Partial<typeof chartOfAccounts.$inferInsert>)
    .where(
      and(
        eq(chartOfAccounts.id, accountId),
        eq(chartOfAccounts.businessId, businessId),
      ),
    )
    .returning();
  return row ?? null;
}

// Soft-delete sesuai Adendum 1.1 §A.2 - akun yang pernah dipakai transaksi
// tidak boleh hilang referensinya, cuma disembunyikan dari pilihan baru.
export async function setChartOfAccountActive(businessId: string, accountId: string, isActive: boolean) {
  const [row] = await db
    .update(chartOfAccounts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(chartOfAccounts.id, accountId), eq(chartOfAccounts.businessId, businessId)))
    .returning();
  return row ?? null;
}

// --- Seed starting point (tugas 1.4 poin 3) ---------------------------------

const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Kas', category: 'Asset' as const },
  { code: '1010', name: 'Bank', category: 'Asset' as const, isControlAccount: true },
  { code: '1200', name: 'Piutang Usaha', category: 'Asset' as const },
  { code: '1400', name: 'Persediaan', category: 'Asset' as const },
  { code: '1500', name: 'Aset Tetap', category: 'Asset' as const },
  { code: '2000', name: 'Utang Usaha', category: 'Liability' as const },
  { code: '2100', name: 'Utang Pajak', category: 'Liability' as const },
  { code: '3000', name: 'Modal Pemilik', category: 'Equity' as const },
  { code: '3900', name: 'Laba Ditahan', category: 'Equity' as const },
  { code: '4000', name: 'Pendapatan Penjualan', category: 'Income' as const },
  { code: '4900', name: 'Pendapatan Lain-lain', category: 'Income' as const },
  { code: '5000', name: 'Harga Pokok Penjualan', category: 'Expense' as const },
  { code: '6000', name: 'Beban Gaji', category: 'Expense' as const },
  { code: '6100', name: 'Beban Sewa', category: 'Expense' as const },
  { code: '6200', name: 'Beban Utilitas', category: 'Expense' as const },
  { code: '6900', name: 'Beban Lain-lain', category: 'Expense' as const },
];

// Terima `dbClient` opsional supaya bisa dipanggil DI DALAM transaksi yang
// sama saat bisnis baru dibuat (lihat BusinessRepository.createBusinessWithAdmin).
export async function seedDefaultChartOfAccounts(
  businessId: string,
  dbClient: Pick<typeof db, 'insert'> = db,
) {
  await dbClient.insert(chartOfAccounts).values(
    DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ businessId, ...a })),
  );
}

// Konsisten dengan Customer/Supplier: boleh hapus permanen HANYA kalau
// belum pernah dipakai transaksi apapun (FK constraint di journal_entry_lines
// yang menegakkan ini - lihat isPgForeignKeyViolation di route).
export async function deleteChartOfAccount(businessId: string, accountId: string) {
  const result = await db
    .delete(chartOfAccounts)
    .where(and(eq(chartOfAccounts.id, accountId), eq(chartOfAccounts.businessId, businessId)))
    .returning({ id: chartOfAccounts.id });
  return result.length > 0;
}