ALTER TABLE "contacts" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "autofill_sales_invoice_due_date" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;