ALTER TABLE "tenants" DROP CONSTRAINT "tenants_modules_ck";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "modules" SET DEFAULT '{planning,crm,projects,employees,timesheet,timeoff,finance,reporting}'::text[];--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_modules_ck" CHECK ("tenants"."modules" <@ '{planning,crm,projects,employees,timesheet,timeoff,workforce,finance,reporting}'::text[]);--> statement-breakpoint
-- CD-521: Workforce is now Employees, Timesheet and Time off. A workspace that had Workforce on gets
-- all three; one that had it off gets none. `workforce` stays allowed by the check for one release
-- (a rolled-back app saves its old list); a later migration drops it.
UPDATE "tenants" SET "modules" = array_remove("modules", 'workforce') || '{employees,timesheet,timeoff}'::text[] WHERE 'workforce' = ANY("modules");
