ALTER TABLE "funnel_stages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

-- CD-9: deleting a stage marks it deleted instead of removing the row. deal_stage_history points
-- at stages with composite FKs (from_stage_id, to_stage_id NOT NULL), and those rows are the
-- deals' real path through the funnel, which the conversion metrics read; keeping the row keeps
-- the history whole without nulling or rewriting it.
--
-- A deleted stage must hold no deals: FunnelsService moves them first (and records the moves),
-- and this trigger keeps any other writer from putting a deal into a deleted stage.
CREATE OR REPLACE FUNCTION deals_stage_not_deleted() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM funnel_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.stage_id AND s.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'That stage was deleted. Pick another stage.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_stage_not_deleted', TABLE = 'deals';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER deals_stage_not_deleted
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_stage_not_deleted();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION funnel_stages_delete_empty() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM deals d WHERE d.tenant_id = NEW.tenant_id AND d.stage_id = NEW.id) THEN
    RAISE EXCEPTION 'This stage still has deals. Move them to another stage first.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_stage_not_deleted', TABLE = 'funnel_stages';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funnel_stages_delete_empty
  BEFORE UPDATE OF deleted_at ON funnel_stages
  FOR EACH ROW EXECUTE FUNCTION funnel_stages_delete_empty();
