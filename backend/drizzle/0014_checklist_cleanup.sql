-- Every caller now uses stable checklist item ids; remove the legacy label path.
DROP TRIGGER IF EXISTS deal_tasks_link_checklist_item ON deal_tasks;
DROP FUNCTION IF EXISTS deal_tasks_link_checklist_item();
DROP TRIGGER IF EXISTS funnel_stages_sync_checklist ON funnel_stages;
DROP FUNCTION IF EXISTS funnel_stages_sync_checklist();
DROP INDEX IF EXISTS deal_tasks_playbook_uq;
ALTER TABLE funnel_stages DROP COLUMN checklist;
