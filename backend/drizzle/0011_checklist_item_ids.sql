ALTER TABLE "deal_tasks" ADD COLUMN "checklist_item_id" uuid;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD COLUMN "checklist_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_tasks_playbook_item_uq" ON "deal_tasks" USING btree ("deal_id","stage_id","checklist_item_id") WHERE not "deal_tasks"."off_playbook" and "deal_tasks"."checklist_item_id" is not null;--> statement-breakpoint

-- CD-32: checklist items get stable ids, and playbook to-dos point at the item instead of
-- matching its label, so renaming an item keeps every deal's progress on it.
--
-- 1. Backfill: every existing checklist label becomes an item with a new id, and every playbook
--    to-do whose label is on its stage's checklist is linked to that item (so it keeps its state).
--    To-dos whose label is no longer on the checklist (renamed or removed before this change) stay
--    unlinked, as they were: invisible, never deleted. funnel_stages and deal_tasks force RLS even
--    for their owner, so the backfill lifts that for its two statements (like 0008).
ALTER TABLE "funnel_stages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "funnel_stages" SET "checklist_items" = coalesce(
  (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'label', e.label) ORDER BY e.ord)
     FROM jsonb_array_elements_text("checklist") WITH ORDINALITY AS e(label, ord)),
  '[]'::jsonb);--> statement-breakpoint
UPDATE "deal_tasks" t SET "checklist_item_id" = (item->>'id')::uuid
  FROM "funnel_stages" s, jsonb_array_elements(s."checklist_items") AS item
  WHERE s."tenant_id" = t."tenant_id" AND s."id" = t."stage_id" AND NOT t."off_playbook" AND item->>'label' = t."label";--> statement-breakpoint
ALTER TABLE "funnel_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. checklist (labels) and checklist_items stay in sync whichever one is written. Writing items
--    (the API since CD-32) sets the labels. Writing only labels (code from before CD-32, e.g. a
--    branch running against the same database) rebuilds the items, keeping the id of every label
--    that is still there, so those writers keep working.
CREATE OR REPLACE FUNCTION funnel_stages_sync_checklist() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  prev jsonb := CASE WHEN TG_OP = 'UPDATE' THEN OLD.checklist_items ELSE '[]'::jsonb END;
  items jsonb := '[]'::jsonb;
  lbl text;
  found jsonb;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.checklist_items <> '[]'::jsonb)
     OR (TG_OP = 'UPDATE' AND NEW.checklist_items IS DISTINCT FROM OLD.checklist_items) THEN
    NEW.checklist := coalesce(
      (SELECT jsonb_agg(x.e->'label' ORDER BY x.o) FROM jsonb_array_elements(NEW.checklist_items) WITH ORDINALITY AS x(e, o)),
      '[]'::jsonb);
  ELSIF TG_OP = 'INSERT' OR NEW.checklist IS DISTINCT FROM OLD.checklist THEN
    FOR lbl IN SELECT jsonb_array_elements_text(NEW.checklist) LOOP
      SELECT e INTO found FROM jsonb_array_elements(prev) AS e WHERE e->>'label' = lbl LIMIT 1;
      IF found IS NULL THEN
        found := jsonb_build_object('id', gen_random_uuid(), 'label', lbl);
      ELSE
        prev := coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(prev) AS e WHERE e <> found), '[]'::jsonb);
      END IF;
      items := items || jsonb_build_array(found);
    END LOOP;
    NEW.checklist_items := items;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funnel_stages_sync_checklist
  BEFORE INSERT OR UPDATE OF checklist, checklist_items ON funnel_stages
  FOR EACH ROW EXECUTE FUNCTION funnel_stages_sync_checklist();
--> statement-breakpoint

-- 3. A playbook to-do written by label only (code from before CD-32) is linked to the item with
--    that label on its stage's checklist.
CREATE OR REPLACE FUNCTION deal_tasks_link_checklist_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT NEW.off_playbook AND NEW.checklist_item_id IS NULL THEN
    SELECT (e->>'id')::uuid INTO NEW.checklist_item_id
      FROM funnel_stages s, jsonb_array_elements(s.checklist_items) AS e
      WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.stage_id AND e->>'label' = NEW.label
      LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER deal_tasks_link_checklist_item
  BEFORE INSERT ON deal_tasks
  FOR EACH ROW EXECUTE FUNCTION deal_tasks_link_checklist_item();
