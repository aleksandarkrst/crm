-- CD-74: a lost deal can't sit in its funnel's won stage.
--
-- "Won" isn't stored on the deal: a deal is won while it is in a stage with is_won. Lost is stored
-- (lost_at). DealsService refuses to mark a won deal lost and to move a lost deal, but nothing in
-- the database stopped it. These triggers do, whichever code writes the rows:
--   * deals: setting lost_at on a deal in a won stage, or moving a lost deal into one;
--   * funnel_stages: turning a stage that holds lost deals into a won stage.
-- A check constraint can't look at another table, hence triggers. They run as the caller, so
-- row-level security applies to the lookups as it does to the write itself.
-- Both raise check_violation (23514) naming "deals_lost_not_won", which the API maps to 409.

CREATE OR REPLACE FUNCTION deals_lost_not_won() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.lost_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM funnel_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.stage_id AND s.is_won
  ) THEN
    RAISE EXCEPTION 'A lost deal can''t be in the won stage. Reopen it first, or move it out of the won stage before marking it lost.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_lost_not_won', TABLE = 'deals';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER deals_lost_not_won
  BEFORE INSERT OR UPDATE OF lost_at, stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_lost_not_won();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION funnel_stages_won_without_lost() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.is_won AND NOT OLD.is_won AND EXISTS (
    SELECT 1 FROM deals d WHERE d.tenant_id = NEW.tenant_id AND d.stage_id = NEW.id AND d.lost_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This stage holds lost deals, so it can''t become the won stage.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_lost_not_won', TABLE = 'funnel_stages';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funnel_stages_won_without_lost
  BEFORE UPDATE OF is_won ON funnel_stages
  FOR EACH ROW EXECUTE FUNCTION funnel_stages_won_without_lost();
