-- CD-534: a company's History lists its contacts coming, going and changing their role in the
-- decision ("Nikola Kostić added Marko Stanić as a contact") next to the company's own field
-- changes. Written by a trigger on contacts into the same append-only record_changes table as every
-- other change (0020), so every write path is covered: the API, the CSV import and worker jobs.
--
-- Rows on the company (entity_type 'company', action 'updated'):
--   field 'contact'      old_value → new_value is the contact as {"id", "name"}; null on one side when
--                        the contact was added to or removed from the company. A move writes one row on
--                        each company. Deleting a contact writes the removal; deleting a company with
--                        its contacts (CompaniesService.remove) writes rows the deleted company keeps
--                        in its history, as a deleted deal keeps its own.
--   field 'contactRole'  old_value → new_value is the role in the decision (text or null), label the
--                        contact's name, when a contact of the company changes role.
-- Expand only: no table or column changes, nothing to contract.
CREATE OR REPLACE FUNCTION crm_company_contact_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_id IS NOT NULL THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'company', NEW.company_id, 'updated', 'contact', NULL, jsonb_build_object('id', NEW.id, 'name', NEW.full_name), NEW.full_name,
        app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.company_id IS NOT NULL THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
      VALUES (OLD.tenant_id, 'company', OLD.company_id, 'updated', 'contact', jsonb_build_object('id', OLD.id, 'name', OLD.full_name), NULL, OLD.full_name,
        app_current_user(), app_current_client(), date_trunc('milliseconds', clock_timestamp()));
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    IF OLD.company_id IS NOT NULL THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
      VALUES (OLD.tenant_id, 'company', OLD.company_id, 'updated', 'contact', jsonb_build_object('id', OLD.id, 'name', OLD.full_name), NULL, OLD.full_name,
        app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
    IF NEW.company_id IS NOT NULL THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'company', NEW.company_id, 'updated', 'contact', NULL, jsonb_build_object('id', NEW.id, 'name', NEW.full_name), NEW.full_name,
        app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  ELSIF NEW.company_id IS NOT NULL AND OLD.buyer_role IS DISTINCT FROM NEW.buyer_role THEN
    INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, label, actor_user_id, client_id, changed_at)
    VALUES (NEW.tenant_id, 'company', NEW.company_id, 'updated', 'contactRole', to_jsonb(OLD.buyer_role), to_jsonb(NEW.buyer_role), NEW.full_name,
      app_current_user(), app_current_client(), NEW.updated_at);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER contacts_company_history AFTER INSERT OR UPDATE OR DELETE ON "contacts" FOR EACH ROW EXECUTE FUNCTION crm_company_contact_changes();
