-- Project value and budget (CD-256): they join the project's history. Projects made from a deal
-- before this get the deal's amount and currency as their value.

-- The history trigger goes first, so the backfill below writes no history rows.
DROP TRIGGER projects_history ON "projects";--> statement-breakpoint

-- Every workspace, with app.tenant_id set so RLS (forced for the owner too) admits the rows.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM tenants ORDER BY id LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE projects p SET value = d.amount, currency = d.currency
    FROM deals d
    WHERE d.tenant_id = p.tenant_id AND d.id = p.deal_id AND p.tenant_id = t.id AND p.value IS NULL AND d.amount > 0;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint

CREATE TRIGGER projects_history AFTER INSERT OR UPDATE OR DELETE ON "projects" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'project', 'name', 'name:name', 'project_type_id:projectTypeId', 'stage_id:stageId', 'status:status', 'cancel_reason:cancelReason', 'company_id:companyId',
  'deal_id:dealId', 'lead_user_id:leadUserId', 'code:code', 'description:description', 'start_date:startDate', 'end_date:endDate', 'health:health',
  'value:value', 'currency:currency', 'budget_hours:budgetHours');
