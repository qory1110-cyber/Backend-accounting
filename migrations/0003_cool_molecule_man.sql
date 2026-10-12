ALTER TABLE "bank_accounts" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;