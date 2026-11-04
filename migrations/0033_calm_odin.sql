CREATE TABLE "delivery_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_note_id" uuid NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"sales_invoice_id" uuid,
	"delivery_date" date NOT NULL,
	"reference" varchar(100),
	"delivery_address" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;