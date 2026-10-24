-- CD-361: "Role in the decision" is optional now (0118). Contacts that only had the automatic
-- 'Influencer' default (it can't be told apart from one picked on purpose; the owner decided to clear
-- all of them) get no role, so the company page flags them. This is a conversion, not an edit: it
-- skips the change history (no author) and keeps each contact's version, so open edits don't get a 409.
-- Row-level security is lifted for the conversion (as in 0022), so it reaches every workspace whichever
-- role runs the migrations.
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" DISABLE TRIGGER "contacts_history";--> statement-breakpoint
ALTER TABLE "contacts" DISABLE TRIGGER "contacts_version";--> statement-breakpoint
UPDATE "contacts" SET "buyer_role" = NULL WHERE "buyer_role" = 'Influencer';--> statement-breakpoint
ALTER TABLE "contacts" ENABLE TRIGGER "contacts_version";--> statement-breakpoint
ALTER TABLE "contacts" ENABLE TRIGGER "contacts_history";--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The contact's details and personal details are recorded like its other fields (every CRM user sees
-- them on the contact, so their history may show them too). The function is unchanged.
DROP TRIGGER "contacts_history" ON "contacts";--> statement-breakpoint
CREATE TRIGGER contacts_history AFTER INSERT OR UPDATE OR DELETE ON "contacts" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'contact', 'full_name', 'full_name:fullName', 'company_id:companyId', 'job_title:jobTitle', 'email:email', 'phone:phone',
  'linkedin:linkedin', 'buyer_role:buyerRole', 'owner_user_id:ownerUserId', 'notes:notes', 'org_unit:orgUnit', 'source:source',
  'influence:influence', 'birthday:birthday', 'spouse_name:spouseName', 'children:children', 'pets:pets');--> statement-breakpoint

-- An employee's spouse, children and pets are recorded like the other personal details (0039): the
-- history hides them from whoever can't see personal details (PERSONAL_FIELDS in field-rules.ts).
CREATE OR REPLACE FUNCTION people_record_personal_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  tracked text[] := ARRAY[
    'date_of_birth:dateOfBirth', 'private_email:privateEmail', 'private_phone:privatePhone', 'address_street:addressStreet',
    'address_postal_code:addressPostalCode', 'address_city:addressCity', 'address_country:addressCountry',
    'emergency_contact_name:emergencyContactName', 'emergency_contact_phone:emergencyContactPhone', 'spouse:spouse',
    'children:children', 'pets:pets', 'iban_masked:iban', 'bank_name:bankName', 'fx_same_as_iban:fxSameAsIban',
    'fx_iban_masked:fxIban', 'swift_bic:swiftBic', 'fx_bank_name:fxBankName', 'fx_bank_address:fxBankAddress'];
  pair text;
  col text;
  o jsonb;
  n jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
  ELSE
    o := '{}'::jsonb;
  END IF;
  FOREACH pair IN ARRAY tracked LOOP
    col := split_part(pair, ':', 1);
    IF TG_OP = 'INSERT' AND (col = 'fx_same_as_iban' OR jsonb_typeof(n -> col) = 'null') THEN
      CONTINUE;
    END IF;
    IF coalesce(o -> col, 'null'::jsonb) IS DISTINCT FROM coalesce(n -> col, 'null'::jsonb) THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'employee', NEW.employee_id, 'updated', split_part(pair, ':', 2), o -> col, n -> col, app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
