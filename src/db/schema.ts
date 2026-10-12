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
import { sql } from 'drizzle-orm';

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
export const salesInvoiceStatusEnum = pgEnum('sales_invoice_status', ['draft', 'sent', 'void']);
export const purchaseInvoiceStatusEnum = pgEnum('purchase_invoice_status', ['draft', 'approved', 'void']);

// --- Bisnis & Pengguna (Multi-Tenant & Access) ------------------------------

export const businesses = pgTable('businesses', {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 225 }).notNull(),
  baseCurrencyCode: varchar({ length: 3 }).notNull().default('IDR'),
  createdAt: timestamp().notNull().defaultNow(),
  deletedAt: timestamp(), // Adendum 1.1 §A.2 — entitas tenant
  hiddenModules: text().array().notNull().default(sql`'{}'::text[]`),
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
    updatedAt: timestamp().notNull().defaultNow(),
    deletedAt: timestamp(), // Adendum 1.1 §A.2
    
  },
  (table) => [unique().on(table.businessId, table.code)],
);

export const contacts = pgTable('contacts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  code: varchar({ length: 50 }),
  name: varchar({ length: 225 }).notNull(),
  email: varchar({ length: 225 }),
  billingAddress: text(),
  deliveryAddress: text(), // baru - §8.3 dokumen analisis Customers
  isCustomer: boolean().notNull().default(false),
  isSupplier: boolean().notNull().default(false),
  creditLimit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  updatedAt: timestamp().notNull().defaultNow(),
  autofillSalesInvoiceDueDate: boolean().notNull().default(false), // baru - §8.3
  isActive: boolean().notNull().default(true), // baru - toggle §8.4-8.5, BUKAN deletedAt
  deletedAt: timestamp(), // dibiarkan menganggur, sama seperti chart_of_accounts
});

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  controlAccountId: uuid().notNull().unique().references(() => chartOfAccounts.id),
  code: varchar({ length: 50 }), // BARU - "Code" di dokumen (§4.3), beda dari accountNumber (IBAN)
  name: varchar({ length: 255 }).notNull(),
  accountNumber: varchar({ length: 50 }), // IBAN
  openingBalance: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  openingBalanceDate: date(),
  canHavePendingTransactions: boolean().notNull().default(true),
  creditLimit: numeric({ precision: 18, scale: 2 }).notNull().default('0.00'),
  isActive: boolean().notNull().default(true), // BARU - toggle, pola sama seperti COA/Customer/Supplier
  lockDate: date(), // transaksi bertanggal <= lockDate pada bank ini terkunci (maju otomatis lewat rekonsiliasi)
  deletedAt: timestamp(),
  updatedAt: timestamp().notNull().defaultNow(),
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
  createdAt: timestamp().notNull().defaultNow(),
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

export const salesInvoices = pgTable('sales_invoices', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  customerId: uuid().notNull().references(() => contacts.id),
  issueDate: date().notNull(),
  dueDate: date(),
  reference: varchar({ length: 100 }),
  billingAddress: text(),
  description: text(),
  status: salesInvoiceStatusEnum().notNull().default('draft'),
  journalEntryId: uuid().references(() => journalEntries.id), // diisi saat status jadi 'sent'
});

export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid().defaultRandom().primaryKey(),
  salesInvoiceId: uuid().notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  accountId: uuid().notNull().references(() => chartOfAccounts.id), // akun Income
  qty: numeric({ precision: 18, scale: 2 }).notNull(),
  unitPrice: numeric({ precision: 18, scale: 2 }).notNull(),
});

export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  supplierId: uuid().notNull().references(() => contacts.id),
  issueDate: date().notNull(),
  dueDate: date(),
  reference: varchar({ length: 100 }),
  description: text(),
  status: purchaseInvoiceStatusEnum().notNull().default('draft'),
  journalEntryId: uuid().references(() => journalEntries.id), // diisi saat status jadi 'approved'
});

export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid().defaultRandom().primaryKey(),
  purchaseInvoiceId: uuid().notNull().references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
  accountId: uuid().notNull().references(() => chartOfAccounts.id), // akun Expense
  qty: numeric({ precision: 18, scale: 2 }).notNull(),
  unitPrice: numeric({ precision: 18, scale: 2 }).notNull(),
});

export const receipts = pgTable('receipts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  receiptDate: date().notNull(),
  reference: varchar({ length: 100 }).notNull(),
  receivedInBankAccountId: uuid().notNull().references(() => bankAccounts.id),
  paidByContactId: uuid().references(() => contacts.id),
  description: text(),
  cleared: boolean().notNull().default(true),
  journalEntryId: uuid().notNull().references(() => journalEntries.id),
});

export const receiptLines = pgTable('receipt_lines', {
  id: uuid().defaultRandom().primaryKey(),
  receiptId: uuid().notNull().references(() => receipts.id, { onDelete: 'cascade' }),
  accountId: uuid().notNull().references(() => chartOfAccounts.id),
  salesInvoiceId: uuid().references(() => salesInvoices.id), // diisi kalau baris ini melunasi faktur
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
});

export const payments = pgTable('payments', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  paymentDate: date().notNull(),
  reference: varchar({ length: 100 }).notNull(),
  paidFromBankAccountId: uuid().notNull().references(() => bankAccounts.id),
  payeeContactId: uuid().notNull().references(() => contacts.id), // wajib, beda dari Receipts
  description: text(),
  cleared: boolean().notNull().default(true),
  journalEntryId: uuid().notNull().references(() => journalEntries.id),
});

export const paymentLines = pgTable('payment_lines', {
  id: uuid().defaultRandom().primaryKey(),
  paymentId: uuid().notNull().references(() => payments.id, { onDelete: 'cascade' }),
  accountId: uuid().notNull().references(() => chartOfAccounts.id),
  purchaseInvoiceId: uuid().references(() => purchaseInvoices.id), // diisi kalau baris ini melunasi faktur
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
});

export const interAccountTransfers = pgTable('inter_account_transfers', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  transferDate: date().notNull(),
  reference: varchar({ length: 100 }).notNull(),
  description: text(),
  paidFromBankAccountId: uuid().notNull().references(() => bankAccounts.id),
  receivedInBankAccountId: uuid().notNull().references(() => bankAccounts.id),
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
  paidFromCleared: boolean().notNull().default(true),
  receivedInCleared: boolean().notNull().default(true),
  journalEntryId: uuid().notNull().references(() => journalEntries.id),
});

export const bankReconciliations = pgTable('bank_reconciliations', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid().notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  bankAccountId: uuid().notNull().references(() => bankAccounts.id),
  reconciliationDate: date().notNull(),
  statementBalance: numeric({ precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});