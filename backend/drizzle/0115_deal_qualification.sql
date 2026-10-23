ALTER TABLE "deals" ADD COLUMN "sponsor_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "power_sponsor_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "pain" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "pain_solution" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualification_steps" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualification_other" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "qualified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_qualified_by_user_id_users_id_fk" FOREIGN KEY ("qualified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sponsor_fk" FOREIGN KEY ("tenant_id","sponsor_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_power_sponsor_fk" FOREIGN KEY ("tenant_id","power_sponsor_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_tenant_sponsor_idx" ON "deals" USING btree ("tenant_id","sponsor_contact_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_power_sponsor_idx" ON "deals" USING btree ("tenant_id","power_sponsor_contact_id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_qualification_steps_ck" CHECK ("deals"."qualification_steps" <@ array['Confirm pain', 'Identify decision maker', 'Confirm budget', 'Validate solution fit', 'Agree on timeline']::text[]);