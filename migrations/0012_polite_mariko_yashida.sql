CREATE TABLE "inter_account_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"transfer_date" date NOT NULL,
	"reference" varchar(100) NOT NULL,
	"description" text,
	"paid_from_bank_account_id" uuid NOT NULL,
	"received_in_bank_account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"paid_from_cleared" boolean DEFAULT true NOT NULL,
	"received_in_cleared" boolean DEFAULT true NOT NULL,
	"journal_entry_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inter_account_transfers" ADD CONSTRAINT "inter_account_transfers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_account_transfers" ADD CONSTRAINT "inter_account_transfers_paid_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("paid_from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_account_transfers" ADD CONSTRAINT "inter_account_transfers_received_in_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("received_in_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inter_account_transfers" ADD CONSTRAINT "inter_account_transfers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;