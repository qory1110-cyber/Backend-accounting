import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  numeric,
  jsonb,
  date,
  unique,
} from 'drizzle-orm/pg-core';

// Skema ini adalah port langsung dari LAPORAN_FASE_1_1_Desain_Database.docx
// (termasuk Adendum 1.1: Soft-Delete) ke Drizzle ORM. Nama tabel/kolom tidak
// boleh berubah tanpa memperbarui laporan itu dulu.
//
// `casing: 'snake_case'` diset di db/index.ts dan drizzle.config.ts — jadi
// properti camelCase di sini (mis. businessId) otomatis jadi kolom
// snake_case (business_id) tanpa perlu ditulis manual.

export const businessRoleEnum = pgEnum('business_role', ['admin', 'accountant', 'viewer']);
export const accountCategoryEnum = pgEnum('account_category', ['Asset', 'Liability', 'Equity', 'Income', 'Expense']);
export const auditActionEnum = pgEnum('audit_action', ['CREATE', 'UPDATE', 'DELETE']);

// --- Bisnis & Pengguna (Multi-Tenant & Access) ------------------------------

export const businesses = pgTable('businesses', {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 225 }).notNull(),
  baseCurrencyCode: varchar({ length: 3 }).notNull().default('IDR'),
  createdAt: timestamp().notNull().defaultNow(),
  deletedAt: timestamp(), // Adendum 1.1 §A.2 — entitas tenant
});

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 225 }).notNull(),
  email: varchar({ length: 225 }).notNull().unique(),
  passwordHash: varchar({ length: 225 }).notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  // TIDAK ada deletedAt — direktori global, lihat Adendum 1.1 §A.3
});

export const userBusinessRoles = pgTable(
  'user_business_roles',
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    role: businessRoleEnum().notNull(),
    // 'invited' | 'active' — lihat LAPORAN_FASE_1_2_Backend.docx §2.5.2
    status: varchar({ length: 20 }).notNull().default('active'),
  },
  (table) => [unique().on(table.userId, table.businessId)],
);

// --- Master Data Akuntansi ---------------------------------------------------

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid().defaultRandom().primaryKey(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    code: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 225 }).notNull(),
    category: accountCategoryEnum().notNull(),
    groupName: varchar({ length: 100 }),
    currencyCode: varchar({ length: 3 }).notNull().default('IDR'),
    isControlAccount: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true), // <- baris baru: toggle §7.4-7.5 dokumen analisis
    deletedAt: timestamp(), // Adendum 1.1 §A.2
  },
  (table) => [unique().on(table.businessId, table.code)],
);

export const contacts = pgTable('contacts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid()
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  code: varchar({ length: 50 }),
  name: varchar({ length: 225 }).notNull(),
  email: varchar({ length: 225 }),
  billingAddress: text(),
  isCustomer: boolean().notNull().default(false),
  isSupplier: boolean().notNull().default(false),
  creditLimit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  deletedAt: timestamp(), // Adendum 1.1 §A.2
});

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid()
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  controlAccountId: uuid()
    .notNull()
    .unique()
    .references(() => chartOfAccounts.id),
  name: varchar({ length: 255 }).notNull(),
  accountNumber: varchar({ length: 50 }),
  openingBalance: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  openingBalanceDate: date(),
  canHavePendingTransactions: boolean().notNull().default(true),
  creditLimit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  deletedAt: timestamp(), // Adendum 1.1 §A.2
});

// --- Double-Entry Ledger — PERMANEN, tidak ada deletedAt (Adendum 1.1 §A.3) --

export const journalEntries = pgTable('journal_entries', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid()
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  entryDate: date().notNull(),
  reference: varchar({ length: 100 }),
  sourceModule: varchar({ length: 50 }).notNull(),
  sourceId: uuid(),
  description: text(),
});

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: uuid().defaultRandom().primaryKey(),
  journalEntryId: uuid()
    .notNull()
    .references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: uuid()
    .notNull()
    .references(() => chartOfAccounts.id),
  contactId: uuid().references(() => contacts.id),
  currencyCode: varchar({ length: 3 }).notNull().default('IDR'),
  exchangeRate: numeric({ precision: 12, scale: 6 }).notNull().default('1.000000'),
  amountForeign: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  debit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  credit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  description: text(),
});

// --- Audit Trail — PERMANEN, tidak ada deletedAt (Adendum 1.1 §A.3) ----------

export const auditLogs = pgTable('audit_logs', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid()
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  action: auditActionEnum().notNull(),
  entityType: varchar({ length: 100 }).notNull(),
  entityId: uuid().notNull(),
  oldValues: jsonb(),
  newValues: jsonb(),
  createdAt: timestamp().notNull().defaultNow(),
});

// --- Autentikasi (LAPORAN_FASE_1_2_Backend.docx §2.3.2) ----------------------

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar({ length: 255 }).notNull(),
  expiresAt: timestamp().notNull(),
  revokedAt: timestamp(),
  userAgent: text(),
  createdAt: timestamp().notNull().defaultNow(),
});
