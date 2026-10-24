-- CD-358: every existing company gets the status the rules give it (crm/companies/company-status.ts,
-- computeStatus), so old and new companies follow one rule:
--   Client       an opportunity was won, or it has a project that wasn't cancelled; Past client
--                instead when nothing is open (no open opportunity or project) and a project was completed.
--   Not interested  it has opportunities and every one was lost.
--   Opportunity  PIB, matični broj, street, city, postal code and šifra delatnosti are filled in and a
--                contact has a job title, a role in the decision and an owner.
--   Lead         everything else (the column default).
-- Nothing else is touched and no audit rows are written. These tables force RLS even for their
-- owner, so the backfill lifts that for its one statement (like 0011).
ALTER TABLE "companies" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funnel_stages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "companies" c SET "status" = s."status", "status_changed_at" = now()
  FROM (
    SELECT c."id",
      CASE
        WHEN o."won" OR p."any" THEN
          CASE WHEN NOT (o."open" OR p."open") AND p."completed" THEN 'past_client' ELSE 'client' END
        WHEN o."total" > 0 AND o."lost" = o."total" THEN 'not_interested'
        WHEN nullif(btrim(c."pib"), '') IS NOT NULL AND nullif(btrim(c."mb"), '') IS NOT NULL
          AND nullif(btrim(c."address"), '') IS NOT NULL AND nullif(btrim(c."city"), '') IS NOT NULL
          AND nullif(btrim(c."postal_code"), '') IS NOT NULL AND nullif(btrim(c."activity_code"), '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "contacts" ct
             WHERE ct."tenant_id" = c."tenant_id" AND ct."company_id" = c."id"
               AND nullif(btrim(ct."job_title"), '') IS NOT NULL AND ct."buyer_role" IS NOT NULL AND ct."owner_user_id" IS NOT NULL)
          THEN 'opportunity'
        ELSE 'lead'
      END AS "status"
    FROM "companies" c
    CROSS JOIN LATERAL (
      SELECT count(*) AS "total",
             count(*) FILTER (WHERE d."lost_at" IS NOT NULL) AS "lost",
             coalesce(bool_or(d."lost_at" IS NULL AND fs."is_won"), false) AS "won",
             coalesce(bool_or(d."lost_at" IS NULL AND NOT fs."is_won"), false) AS "open"
        FROM "deals" d JOIN "funnel_stages" fs ON fs."tenant_id" = d."tenant_id" AND fs."id" = d."stage_id"
       WHERE d."tenant_id" = c."tenant_id" AND d."company_id" = c."id") o
    CROSS JOIN LATERAL (
      SELECT coalesce(bool_or(pr."status" <> 'cancelled'), false) AS "any",
             coalesce(bool_or(pr."status" = 'open'), false) AS "open",
             coalesce(bool_or(pr."status" = 'completed'), false) AS "completed"
        FROM "projects" pr
       WHERE pr."tenant_id" = c."tenant_id" AND pr."company_id" = c."id") p
  ) s
  WHERE s."id" = c."id" AND s."status" <> 'lead';--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funnel_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
