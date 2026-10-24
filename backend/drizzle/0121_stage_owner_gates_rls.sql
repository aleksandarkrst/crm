-- deal_stage_states (CD-363). See "CRM: funnels and the advance gate" in docs/ARCHITECTURE.md.
ALTER TABLE "deal_stage_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_stage_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "deal_stage_states" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- "All to-dos must be done" is on for new stages (the column default) and off for the stages that
-- exist today, so current funnels keep moving freely until an admin switches it on (decided
-- 24 Oct). Row-level security is lifted for the conversion, as in 0022, so it reaches every workspace.
ALTER TABLE "funnel_stages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "funnel_stages" SET "gate_todos" = false;--> statement-breakpoint
ALTER TABLE "funnel_stages" FORCE ROW LEVEL SECURITY;
