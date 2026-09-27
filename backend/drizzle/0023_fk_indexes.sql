CREATE INDEX "deal_contacts_tenant_contact_idx" ON "deal_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "deal_lines_tenant_product_idx" ON "deal_lines" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "deal_tasks_tenant_stage_idx" ON "deal_tasks" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "deal_tasks_tenant_assignee_idx" ON "deal_tasks" USING btree ("tenant_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_company_idx" ON "deals" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_contact_idx" ON "deals" USING btree ("tenant_id","primary_contact_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_stage_idx" ON "deals" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_owner_idx" ON "deals" USING btree ("tenant_id","owner_user_id");