import { and, eq, isNull, sql } from 'drizzle-orm';
import db from '../db/index.js';
import { businesses, userBusinessRoles, users, contacts,
  bankAccounts,
  salesInvoices,
  purchaseInvoices,
  receipts,
  payments,
  interAccountTransfers, } from '../db/schema.js';
import { seedDefaultChartOfAccounts } from './ChartOfAccountRepository.js';

// ---------------------------------------------------------------------------
// Prinsip wajib (Backend-Boilerplate-Guide.pdf §5.4 + LAPORAN_FASE_1_2 §2.4):
// "Company scoping ditegakkan di query (company_id dari token), bukan di
// middleware saja." Setiap fungsi di bawah yang menyentuh data sebuah bisnis
// menerima businessId secara eksplisit dan menaruhnya di klausa WHERE —
// tidak ada fungsi yang query berdasarkan id saja.
// ---------------------------------------------------------------------------

export async function createBusinessWithAdmin(
  ownerUserId: string,
  data: { name: string; baseCurrencyCode?: string },
) {
  // Transaksi: bisnis baru + baris keanggotaan admin dibuat sekaligus,
  // supaya tidak pernah ada bisnis "yatim" tanpa admin kalau salah satu gagal.
  return db.transaction(async (tx) => {
    const [business] = await tx.insert(businesses).values(data).returning();

    await tx.insert(userBusinessRoles).values({
      userId: ownerUserId,
      businessId: business.id,
      role: 'admin',
      status: 'active',
    });

    // Setiap bisnis baru langsung dapat Chart of Accounts standar sebagai
    // starting point (tugas 1.4 poin 3) - dalam transaksi yang sama, supaya
    // tidak mungkin ada bisnis baru tanpa COA kalau salah satu langkah gagal.
    await seedDefaultChartOfAccounts(business.id, tx);

    return business;
  });
}

export async function listBusinessesForUser(userId: string) {
  return db
    .select({
      id: businesses.id,
      name: businesses.name,
      baseCurrencyCode: businesses.baseCurrencyCode,
      role: userBusinessRoles.role,
      hiddenModules: businesses.hiddenModules,
    })
    .from(userBusinessRoles)
    .innerJoin(businesses, eq(businesses.id, userBusinessRoles.businessId))
    .where(and(eq(userBusinessRoles.userId, userId), isNull(businesses.deletedAt)));
}

// Dipanggil oleh guard `requireBusinessScope` — SATU query ini yang jadi
// jantung isolasi multi-tenant (§6.3 dokumen analisis: bug di sini = insiden
// kerahasiaan klien). Mengembalikan null berarti user BUKAN anggota bisnis
// ini (atau bisnisnya sudah di-soft-delete) — route wajib merespons 404,
// bukan 403, supaya ID bisnis tidak bisa dienumerasi (lihat AuthMiddleware.ts).
export async function findMembership(userId: string, businessId: string) {
  const [row] = await db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      role: userBusinessRoles.role,
      status: userBusinessRoles.status,
    })
    .from(userBusinessRoles)
    .innerJoin(businesses, eq(businesses.id, userBusinessRoles.businessId))
    .where(
      and(
        eq(userBusinessRoles.userId, userId),
        eq(userBusinessRoles.businessId, businessId),
        isNull(businesses.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findBusinessById(businessId: string) {
  const [row] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function updateBusiness(
  businessId: string,
  data: { name?: string; baseCurrencyCode?: string; hiddenModules?: string[] },
) {
  const [row] = await db
    .update(businesses)
    .set(data)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .returning();
  return row ?? null;
}

// --- Anggota bisnis (Modul Users per-bisnis, §2.5 LAPORAN_FASE_1_2) ---------

export async function listMembers(businessId: string, page: number, pageSize: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(userBusinessRoles)
    .where(eq(userBusinessRoles.businessId, businessId));

  const data = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: userBusinessRoles.role,
      status: userBusinessRoles.status,
    })
    .from(userBusinessRoles)
    .innerJoin(users, eq(users.id, userBusinessRoles.userId))
    .where(eq(userBusinessRoles.businessId, businessId))
    .orderBy(userBusinessRoles.role, users.name, users.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { data, total: Number(count) };
}

export async function addMember(
  businessId: string,
  userId: string,
  role: 'admin' | 'accountant' | 'viewer',
  status: 'invited' | 'active' = 'invited',
) {
  const [row] = await db
    .insert(userBusinessRoles)
    .values({ businessId, userId, role, status })
    .returning();
  return row;
}

export async function updateMemberRole(
  businessId: string,
  userId: string,
  role: 'admin' | 'accountant' | 'viewer',
) {
  const [row] = await db
    .update(userBusinessRoles)
    .set({ role })
    .where(and(eq(userBusinessRoles.businessId, businessId), eq(userBusinessRoles.userId, userId)))
    .returning();
  return row ?? null;
}

export async function removeMember(businessId: string, userId: string) {
  const result = await db
    .delete(userBusinessRoles)
    .where(and(eq(userBusinessRoles.businessId, businessId), eq(userBusinessRoles.userId, userId)))
    .returning({ id: userBusinessRoles.id });
  return result.length > 0;
}

export async function deleteBusiness(businessId: string) {
  const result = await db.delete(businesses).where(eq(businesses.id, businessId)).returning({ id: businesses.id });
  return result.length > 0;
}

// Manager.io asli: "Unwanted tabs can be disabled only if they contain no
// transactions or records" - larangan ini cuma berlaku untuk modul yang
// BARU hendak disembunyikan pada permintaan ini (bukan yang sudah lama
// tersembunyi), supaya memunculkan kembali modul lama tetap bebas kapan saja.
export async function findModulesWithDataAmongNewlyHidden(
  businessId: string,
  currentHidden: string[],
  requestedHidden: string[],
) {
  const newlyHidden = requestedHidden.filter((key) => !currentHidden.includes(key));
  if (newlyHidden.length === 0) return [];

  const checks: Record<string, () => Promise<number>> = {
    customers: async () => {
      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.businessId, businessId), eq(contacts.isCustomer, true)));
      return rows.length;
    },
    suppliers: async () => {
      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.businessId, businessId), eq(contacts.isSupplier, true)));
      return rows.length;
    },
    'bank-accounts': async () => {
      const rows = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.businessId, businessId));
      return rows.length;
    },
    'sales-invoices': async () => {
      const rows = await db.select({ id: salesInvoices.id }).from(salesInvoices).where(eq(salesInvoices.businessId, businessId));
      return rows.length;
    },
    'purchase-invoices': async () => {
      const rows = await db
        .select({ id: purchaseInvoices.id })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.businessId, businessId));
      return rows.length;
    },
    receipts: async () => {
      const rows = await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.businessId, businessId));
      return rows.length;
    },
        payments: async () => {
      const rows = await db.select({ id: payments.id }).from(payments).where(eq(payments.businessId, businessId));
      return rows.length;
    },
    'inter-account-transfers': async () => {
      const rows = await db
        .select({ id: interAccountTransfers.id })
        .from(interAccountTransfers)
        .where(eq(interAccountTransfers.businessId, businessId));
      return rows.length;
    },
  };

  const withData: string[] = [];
  for (const key of newlyHidden) {
    const count = await checks[key]?.();
    if (count && count > 0) withData.push(key);
  }
  return withData;
}