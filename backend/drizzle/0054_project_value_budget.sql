ALTER TABLE "projects" ADD COLUMN "value" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_hours" numeric(8, 1);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_value_ck" CHECK ("projects"."value" is null or "projects"."value" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_hours_ck" CHECK ("projects"."budget_hours" is null or "projects"."budget_hours" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_currency_ck" CHECK ("projects"."currency" is null or "projects"."currency" ~ '^[A-Z]{3}$');