-- Company history (CD-357): the identity fields are recorded like the others (who changed the PIB, the
-- address, ...). The trigger is recreated with the longer column list; the function is unchanged.
DROP TRIGGER companies_history ON "companies";--> statement-breakpoint
CREATE TRIGGER companies_history AFTER INSERT OR UPDATE OR DELETE ON "companies" FOR EACH ROW EXECUTE FUNCTION crm_record_changes(
  'company', 'name', 'name:name', 'industry:industry', 'hq:hq', 'team_size:teamSize', 'source:source', 'domain:domain',
  'owner_user_id:ownerUserId', 'notes:notes', 'pib:pib', 'mb:mb', 'address:address', 'city:city', 'postal_code:postalCode',
  'activity_code:activityCode', 'ownership_type:ownershipType');
