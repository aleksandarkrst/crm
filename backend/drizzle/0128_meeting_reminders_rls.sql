-- meeting_reminders (CD-376). See "CRM: meetings" in docs/ARCHITECTURE.md.
ALTER TABLE "meeting_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_reminders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "meeting_reminders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- The people on meetings still to come get the reminders a new participant gets: 1 hour before,
-- and 1 day before too for a customer visit. One whose time has already passed counts as sent
-- for this start, so nobody gets a late reminder on the day this ships. Row-level security is
-- lifted for the backfill, as in 0121, so it reaches every workspace.
ALTER TABLE "meeting_reminders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_participants" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "meeting_reminders" ("tenant_id", "meeting_id", "user_id", "minutes_before", "unit", "sent_for")
SELECT m."tenant_id", m."id", p."user_id", d."minutes", d."unit",
       CASE WHEN m."starts_at" - make_interval(mins => d."minutes") <= now() THEN m."starts_at" END
  FROM "meetings" m
  JOIN "meeting_participants" p ON p."tenant_id" = m."tenant_id" AND p."meeting_id" = m."id" AND p."kind" = 'internal'
  JOIN "memberships" ms ON ms."tenant_id" = m."tenant_id" AND ms."user_id" = p."user_id"
  CROSS JOIN LATERAL (VALUES (60, 'hours'), (1440, 'days')) AS d("minutes", "unit")
 WHERE m."status" = 'planned' AND m."starts_at" > now() AND (d."minutes" = 60 OR m."type" = 'visit')
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "meeting_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_reminders" FORCE ROW LEVEL SECURITY;
