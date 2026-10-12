CREATE TYPE "public"."purchase_invoice_status" AS ENUM('draft', 'approved', 'void');--> statement-breakpoint
CREATE TABLE "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"qty" numeric(18, 2) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"reference" varchar(100),
	"description" text,
	"status" "purchase_invoice_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid
);
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_contacts_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;