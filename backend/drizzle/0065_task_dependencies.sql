ALTER TABLE "tasks" ADD COLUMN "waits_for_task_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_tenant_waits_for_idx" ON "tasks" USING btree ("tenant_id","waits_for_task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_not_own_dependency_ck" CHECK ("tasks"."waits_for_task_id" is null or "tasks"."waits_for_task_id" <> "tasks"."id");