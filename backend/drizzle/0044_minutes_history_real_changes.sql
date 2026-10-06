-- CD-222: the meeting's history only records next steps that really changed. Steps compare by
-- their id, text, owner and due date in order; the task created from a step ("Create task") is a
-- link, not a change of the minutes, and a key stored without a value equals one stored as null.
CREATE OR REPLACE FUNCTION crm_minutes_steps(steps jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s -> 'id',
        'text', to_jsonb(btrim(coalesce(s ->> 'text', ''))),
        'ownerUserId', coalesce(s -> 'ownerUserId', 'null'::jsonb),
        'dueDate', coalesce(s -> 'dueDate', 'null'::jsonb)
      ) ORDER BY ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(steps) = 'array' THEN steps ELSE '[]'::jsonb END) WITH ORDINALITY AS t(s, ord)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_record_minutes_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  o jsonb;
  n jsonb := to_jsonb(NEW);
  pair text;
  col text;
  same boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    o := jsonb_build_object('summary', NULL, 'agreements', NULL, 'next_steps', '[]'::jsonb);
  ELSE
    o := to_jsonb(OLD);
  END IF;
  FOREACH pair IN ARRAY ARRAY['summary:summary', 'agreements:agreements', 'next_steps:nextSteps'] LOOP
    col := split_part(pair, ':', 1);
    IF col = 'next_steps' THEN
      same := crm_minutes_steps(o -> col) = crm_minutes_steps(n -> col);
    ELSE
      same := (o -> col) IS NOT DISTINCT FROM (n -> col);
    END IF;
    IF NOT same THEN
      INSERT INTO record_changes (tenant_id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, client_id, changed_at)
      VALUES (NEW.tenant_id, 'meeting', NEW.meeting_id, 'updated', split_part(pair, ':', 2), o -> col, n -> col, app_current_user(), app_current_client(), NEW.updated_at);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
