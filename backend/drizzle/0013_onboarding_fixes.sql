ALTER TABLE memberships ADD COLUMN onboarding_dismissed_at timestamptz;
ALTER TABLE contacts ADD COLUMN notes text;

-- memberships is deliberately outside RLS, so a trigger keeps this reference tidy.
CREATE OR REPLACE FUNCTION clear_deleted_default_funnel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memberships SET default_funnel_id = NULL
    WHERE tenant_id = OLD.tenant_id AND default_funnel_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER funnels_clear_default_before_delete
  BEFORE DELETE ON funnels FOR EACH ROW EXECUTE FUNCTION clear_deleted_default_funnel();
