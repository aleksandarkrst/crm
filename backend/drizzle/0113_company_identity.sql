ALTER TABLE "companies" ADD COLUMN "pib" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "mb" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "activity_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ownership_type" text;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_pib_uq" ON "companies" USING btree ("tenant_id","pib") WHERE "companies"."pib" is not null;