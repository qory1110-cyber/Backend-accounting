CREATE TYPE "public"."sales_invoice_status" AS ENUM('draft', 'sent', 'void');--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"qty" numeric(18, 2) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"reference" varchar(100),
	"billing_address" text,
	"description" text,
	"status" "sales_invoice_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid
);
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;