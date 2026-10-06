-- CD-226: records made by an invitation from Settings → Team (deleted if the invitation is withdrawn
-- or expires before anyone joins).
ALTER TABLE "employees" ADD COLUMN "created_from_invite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Work email = sign-in email: linked employees without a work email get their member's sign-in
-- email, unless another employee of the workspace has it already. app.tenant_id is set per
-- workspace so RLS (forced for the owner too) admits the rows and their history.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM memberships ORDER BY tenant_id LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    UPDATE employees e SET work_email = lower(u.email)
    FROM users u
    WHERE e.tenant_id = t.tenant_id
      AND u.id = e.user_id
      AND e.work_email IS NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM employees o WHERE o.tenant_id = e.tenant_id AND lower(o.work_email) = lower(u.email));
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
