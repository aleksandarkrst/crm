-- Documents (CD-13): row-level security (same policy as 0001_rls.sql), and the link from a
-- generated document to its template.
--
-- deal_documents.template_id references the template within the same tenant. Deleting a template
-- keeps the documents made from it: ON DELETE SET NULL (template_id) nulls only that column
-- (PostgreSQL 15+), never tenant_id. Drizzle can't express a column list here, so it lives in this
-- custom migration rather than in the schema.

ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."document_templates"("tenant_id","id") ON DELETE SET NULL ("template_id");--> statement-breakpoint
CREATE INDEX "deal_documents_tenant_template_idx" ON "deal_documents" USING btree ("tenant_id","template_id");--> statement-breakpoint

ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_templates" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "deal_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "deal_documents" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
