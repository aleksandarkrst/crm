-- Stage history (CD-61): backfill, then row-level security (same policy as 0001_rls.sql).
--
-- Every deal that exists already gets one row: its current stage at its creation time (we don't
-- know how it got there). "By whom" is unknown for these rows, so changed_by_user_id stays null.
-- deals and funnel_stages force RLS even for their owner, so the backfill lifts that for the
-- length of this statement (the migration runs in one transaction, as the owner).

ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funnel_stages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "deal_stage_history" ("tenant_id", "deal_id", "kind", "from_stage_id", "to_stage_id", "outcome", "changed_at", "changed_by_user_id")
SELECT d."tenant_id", d."id", 'created', NULL, d."stage_id", CASE WHEN s."is_won" THEN 'won' ELSE 'open' END, d."created_at", NULL
FROM "deals" d
JOIN "funnel_stages" s ON s."tenant_id" = d."tenant_id" AND s."id" = d."stage_id";--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funnel_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "deal_stage_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_stage_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "deal_stage_history" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
