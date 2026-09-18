import { and, eq, isNull } from 'drizzle-orm';
import db from '../db/index.js';
import { businesses, userBusinessRoles, users } from '../db/schema.js';
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
  data: { name?: string; baseCurrencyCode?: string },
) {
  const [row] = await db
    .update(businesses)
    .set(data)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .returning();
  return row ?? null;
}

// --- Anggota bisnis (Modul Users per-bisnis, §2.5 LAPORAN_FASE_1_2) ---------

export async function listMembers(businessId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: userBusinessRoles.role,
      status: userBusinessRoles.status,
    })
    .from(userBusinessRoles)
    .innerJoin(users, eq(users.id, userBusinessRoles.userId))
    .where(eq(userBusinessRoles.businessId, businessId));
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
