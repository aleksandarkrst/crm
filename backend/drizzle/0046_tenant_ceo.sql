-- The CEO of the workspace (CD-225): the person in the org chart's company node. The composite key
-- keeps them in the workspace; ON DELETE SET NULL (column) nulls only the CEO (PostgreSQL 15+).
ALTER TABLE "tenants" ADD COLUMN "ceo_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ceo_employee_fk" FOREIGN KEY ("id","ceo_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE SET NULL ("ceo_employee_id");
