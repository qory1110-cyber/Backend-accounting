CREATE TABLE "late_payment_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"fee_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "late_payment_fees" ADD CONSTRAINT "late_payment_fees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_payment_fees" ADD CONSTRAINT "late_payment_fees_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_payment_fees" ADD CONSTRAINT "late_payment_fees_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;