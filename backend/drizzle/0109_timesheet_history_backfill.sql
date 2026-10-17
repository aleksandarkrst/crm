-- CD-336 (staging bug 10): days submitted, approved or returned before the day history table
-- existed (0087, CD-157) have no events, so a week's History read "Nothing happened in this week
-- yet". Write the missing steps once, from the day's own timestamps and actors. Idempotent: a step
-- that already has an event is skipped.
INSERT INTO "timesheet_day_events" ("tenant_id", "employee_id", "work_date", "kind", "actor_user_id", "actor_name", "comment", "approval_mode", "created_at")
SELECT d."tenant_id", d."employee_id", d."work_date", 'submitted', d."submitted_by_user_id", u."display_name", NULL, t."timesheet_approval_mode", d."first_submitted_at"
FROM "timesheet_days" d
JOIN "tenants" t ON t."id" = d."tenant_id"
LEFT JOIN "users" u ON u."id" = d."submitted_by_user_id"
WHERE d."first_submitted_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "timesheet_day_events" e
    WHERE e."tenant_id" = d."tenant_id" AND e."employee_id" = d."employee_id" AND e."work_date" = d."work_date" AND e."kind" IN ('submitted', 'auto_submitted')
  );--> statement-breakpoint

INSERT INTO "timesheet_day_events" ("tenant_id", "employee_id", "work_date", "kind", "actor_user_id", "actor_name", "comment", "approval_mode", "created_at")
SELECT d."tenant_id", d."employee_id", d."work_date", 'returned', d."returned_by_user_id", u."display_name", d."comment", t."timesheet_approval_mode", d."returned_at"
FROM "timesheet_days" d
JOIN "tenants" t ON t."id" = d."tenant_id"
LEFT JOIN "users" u ON u."id" = d."returned_by_user_id"
WHERE d."returned_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "timesheet_day_events" e
    WHERE e."tenant_id" = d."tenant_id" AND e."employee_id" = d."employee_id" AND e."work_date" = d."work_date" AND e."kind" = 'returned'
  );--> statement-breakpoint

INSERT INTO "timesheet_day_events" ("tenant_id", "employee_id", "work_date", "kind", "actor_user_id", "actor_name", "comment", "approval_mode", "created_at")
SELECT d."tenant_id", d."employee_id", d."work_date", 'approved', d."approved_by_user_id", u."display_name", NULL, t."timesheet_approval_mode", d."approved_at"
FROM "timesheet_days" d
JOIN "tenants" t ON t."id" = d."tenant_id"
LEFT JOIN "users" u ON u."id" = d."approved_by_user_id"
WHERE d."approved_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "timesheet_day_events" e
    WHERE e."tenant_id" = d."tenant_id" AND e."employee_id" = d."employee_id" AND e."work_date" = d."work_date" AND e."kind" = 'approved'
  );
