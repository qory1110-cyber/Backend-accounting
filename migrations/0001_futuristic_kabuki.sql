ALTER TABLE "chart_of_accounts" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."account_category";--> statement-breakpoint
CREATE TYPE "public"."account_category" AS ENUM('Asset', 'Liability', 'Equity', 'Income', 'Expense');--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ALTER COLUMN "category" SET DATA TYPE "public"."account_category" USING "category"::"public"."account_category";--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;