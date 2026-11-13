ALTER TABLE "tenants" ALTER COLUMN "modules" SET DEFAULT '{planning,crm,projects,employees,timesheet,timeoff,workforce,finance,reporting}'::text[];--> statement-breakpoint
-- CD-521, expand then contract: 0130 replaced `workforce` with its three modules; for this release
-- the rows keep `workforce` as well, on exactly when one of the three is (as the API saves it,
-- `storedModules`), so an app rolled back to before CD-521 still shows Workforce. The contract
-- migration in the next release removes it from the rows and from tenants_modules_ck.
UPDATE "tenants" SET "modules" = "modules" || '{workforce}'::text[] WHERE NOT ('workforce' = ANY("modules")) AND "modules" && '{employees,timesheet,timeoff}'::text[];
