CREATE TYPE "public"."billable_time_status" AS ENUM('uninvoiced', 'invoiced', 'written_off');--> statement-breakpoint
CREATE TABLE "billable_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid,
	"work_date" date NOT NULL,
	"description" text,
	"hourly_rate" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"hours" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"status" "billable_time_status" DEFAULT 'uninvoiced' NOT NULL,
	"written_off_date" date,
	"sales_invoice_id" uuid,
	"journal_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billable_times" ADD CONSTRAINT "billable_times_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billable_times" ADD CONSTRAINT "billable_times_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billable_times" ADD CONSTRAINT "billable_times_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billable_times" ADD CONSTRAINT "billable_times_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;