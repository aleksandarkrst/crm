ALTER TABLE "tenants" ADD COLUMN "project_term" text DEFAULT 'Project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "project_term_plural" text DEFAULT 'Projects' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "task_term" text DEFAULT 'Task' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "task_term_plural" text DEFAULT 'Tasks' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_terms_ck" CHECK (char_length("tenants"."project_term") between 1 and 30 and char_length("tenants"."project_term_plural") between 1 and 30 and char_length("tenants"."task_term") between 1 and 30 and char_length("tenants"."task_term_plural") between 1 and 30);