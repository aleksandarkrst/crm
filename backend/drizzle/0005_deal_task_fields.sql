ALTER TABLE "deal_tasks" ADD COLUMN "blocks_advance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_tasks_tenant_due_idx" ON "deal_tasks" USING btree ("tenant_id","due_date") WHERE "deal_tasks"."due_date" is not null;