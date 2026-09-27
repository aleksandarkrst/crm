-- The audit log is append-only for the app (CD-101), like record_changes: it may read and add
-- rows of its tenant, never change or delete them. Before, one policy allowed every command and
-- the runtime role had UPDATE and DELETE on the table.
--
-- Rows still go when their workspace is deleted (ON DELETE CASCADE) and lose their actor when the
-- user is deleted (SET NULL): foreign-key actions run as the table owner, not the runtime role.
DROP POLICY tenant_isolation ON "audit_logs";--> statement-breakpoint
CREATE POLICY tenant_read ON "audit_logs" FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY tenant_append ON "audit_logs" FOR INSERT WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Take the privileges away too, so a bug fails loudly ("permission denied") instead of touching
-- nothing. The runtime role's name is configurable (APP_DB_USER), so revoke from whoever holds
-- them other than the owner.
DO $$
DECLARE
  grantee text;
BEGIN
  FOR grantee IN
    SELECT DISTINCT g.grantee
      FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND g.table_name = 'audit_logs'
       AND g.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
       AND g.grantee <> (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs')
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM %I', grantee);
  END LOOP;
END
$$;
