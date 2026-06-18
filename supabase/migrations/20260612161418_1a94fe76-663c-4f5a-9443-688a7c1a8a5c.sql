-- 1) Concurrency-safe upsert / remove of a single lead_lines entry
CREATE OR REPLACE FUNCTION public.lead_line_upsert(
  p_table text,
  p_lead_id uuid,
  p_line jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line_id text;
  v_current jsonb;
  v_next jsonb;
  v_found boolean := false;
BEGIN
  IF p_line IS NULL OR jsonb_typeof(p_line) <> 'object' THEN
    RAISE EXCEPTION 'p_line must be a JSON object';
  END IF;
  v_line_id := p_line->>'line_id';
  IF v_line_id IS NULL OR v_line_id = '' THEN
    RAISE EXCEPTION 'p_line.line_id is required';
  END IF;

  IF p_table = 'leads' THEN
    SELECT coalesce(lead_lines, '[]'::jsonb) INTO v_current FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  ELSIF p_table = 'list_leads' THEN
    SELECT coalesce(lead_lines, '[]'::jsonb) INTO v_current FROM public.list_leads WHERE id = p_lead_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported table %', p_table;
  END IF;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  SELECT coalesce(jsonb_agg(
           CASE WHEN elem->>'line_id' = v_line_id
                THEN p_line
                ELSE elem END
         ), '[]'::jsonb)
    INTO v_next
  FROM jsonb_array_elements(v_current) elem;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_current) elem WHERE elem->>'line_id' = v_line_id
  ) INTO v_found;

  IF NOT v_found THEN
    v_next := coalesce(v_current, '[]'::jsonb) || jsonb_build_array(p_line);
  END IF;

  IF p_table = 'leads' THEN
    UPDATE public.leads SET lead_lines = v_next WHERE id = p_lead_id;
  ELSE
    UPDATE public.list_leads SET lead_lines = v_next WHERE id = p_lead_id;
  END IF;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.lead_line_remove(
  p_table text,
  p_lead_id uuid,
  p_line_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current jsonb;
  v_next jsonb;
BEGIN
  IF p_line_id IS NULL OR p_line_id = '' THEN
    RAISE EXCEPTION 'p_line_id is required';
  END IF;

  IF p_table = 'leads' THEN
    SELECT coalesce(lead_lines, '[]'::jsonb) INTO v_current FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  ELSIF p_table = 'list_leads' THEN
    SELECT coalesce(lead_lines, '[]'::jsonb) INTO v_current FROM public.list_leads WHERE id = p_lead_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported table %', p_table;
  END IF;

  IF v_current IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
    INTO v_next
  FROM jsonb_array_elements(v_current) elem
  WHERE elem->>'line_id' <> p_line_id;

  IF p_table = 'leads' THEN
    UPDATE public.leads SET lead_lines = v_next WHERE id = p_lead_id;
  ELSE
    UPDATE public.list_leads SET lead_lines = v_next WHERE id = p_lead_id;
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_line_upsert(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_line_remove(text, uuid, text) TO authenticated;

-- 2) Extend log_lead_activity to diff lead_lines on every UPDATE
CREATE OR REPLACE FUNCTION public.log_lead_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tbl text := TG_TABLE_NAME;
  old_line jsonb;
  new_line jsonb;
  v_line_id text;
  v_type text;
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    IF NEW.claimed_by IS NOT NULL AND OLD.claimed_by IS NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'claimed', jsonb_build_object('side','auto','claimed_by', NEW.claimed_by));
    ELSIF NEW.claimed_by IS NULL AND OLD.claimed_by IS NOT NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'released', jsonb_build_object('side','auto','was_claimed_by', OLD.claimed_by));
    ELSE
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'reassigned', jsonb_build_object('side','auto','from', OLD.claimed_by, 'to', NEW.claimed_by));
    END IF;
  END IF;

  IF NEW.home_claimed_by IS DISTINCT FROM OLD.home_claimed_by THEN
    IF NEW.home_claimed_by IS NOT NULL AND OLD.home_claimed_by IS NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'claimed', jsonb_build_object('side','home','claimed_by', NEW.home_claimed_by));
    ELSIF NEW.home_claimed_by IS NULL AND OLD.home_claimed_by IS NOT NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'released', jsonb_build_object('side','home','was_claimed_by', OLD.home_claimed_by));
    ELSE
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'reassigned', jsonb_build_object('side','home','from', OLD.home_claimed_by, 'to', NEW.home_claimed_by));
    END IF;
  END IF;

  IF NEW.dispo IS DISTINCT FROM OLD.dispo THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'dispo_changed', jsonb_build_object('side','auto','from', OLD.dispo, 'to', NEW.dispo));
  END IF;

  IF NEW.home_dispo IS DISTINCT FROM OLD.home_dispo THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'dispo_changed', jsonb_build_object('side','home','from', OLD.home_dispo, 'to', NEW.home_dispo));
  END IF;

  IF NEW.quoted_premium IS DISTINCT FROM OLD.quoted_premium THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'quoted_premium_changed', jsonb_build_object('side','auto','from', OLD.quoted_premium, 'to', NEW.quoted_premium));
  END IF;

  IF NEW.home_quoted_premium IS DISTINCT FROM OLD.home_quoted_premium THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'quoted_premium_changed', jsonb_build_object('side','home','from', OLD.home_quoted_premium, 'to', NEW.home_quoted_premium));
  END IF;

  IF NEW.agent_notes IS DISTINCT FROM OLD.agent_notes THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'agent_notes_edited', jsonb_build_object('side','auto'));
  END IF;

  IF NEW.home_agent_notes IS DISTINCT FROM OLD.home_agent_notes THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'agent_notes_edited', jsonb_build_object('side','home'));
  END IF;

  -- lead_lines diffing
  IF NEW.lead_lines IS DISTINCT FROM OLD.lead_lines THEN
    -- removed lines (in OLD but not NEW by line_id)
    IF OLD.lead_lines IS NOT NULL AND jsonb_typeof(OLD.lead_lines) = 'array' THEN
      FOR old_line IN SELECT * FROM jsonb_array_elements(OLD.lead_lines) LOOP
        v_line_id := old_line->>'line_id';
        IF v_line_id IS NULL THEN CONTINUE; END IF;
        IF NEW.lead_lines IS NULL OR jsonb_typeof(NEW.lead_lines) <> 'array'
           OR NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(NEW.lead_lines) e WHERE e->>'line_id' = v_line_id
           ) THEN
          v_type := old_line->>'type';
          INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
          VALUES (NEW.id, tbl, uid, 'line_removed',
            jsonb_build_object('line_id', v_line_id, 'type', v_type, 'removed_line', old_line));
        END IF;
      END LOOP;
    END IF;

    -- added / changed lines
    IF NEW.lead_lines IS NOT NULL AND jsonb_typeof(NEW.lead_lines) = 'array' THEN
      FOR new_line IN SELECT * FROM jsonb_array_elements(NEW.lead_lines) LOOP
        v_line_id := new_line->>'line_id';
        IF v_line_id IS NULL THEN CONTINUE; END IF;
        v_type := new_line->>'type';
        old_line := NULL;
        IF OLD.lead_lines IS NOT NULL AND jsonb_typeof(OLD.lead_lines) = 'array' THEN
          SELECT e INTO old_line FROM jsonb_array_elements(OLD.lead_lines) e WHERE e->>'line_id' = v_line_id LIMIT 1;
        END IF;

        IF old_line IS NULL THEN
          INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
          VALUES (NEW.id, tbl, uid, 'line_added',
            jsonb_build_object('line_id', v_line_id, 'type', v_type));
        ELSE
          IF (old_line->>'dispo') IS DISTINCT FROM (new_line->>'dispo') THEN
            INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
            VALUES (NEW.id, tbl, uid, 'line_dispo_changed',
              jsonb_build_object('line_id', v_line_id, 'type', v_type,
                'from', old_line->>'dispo', 'to', new_line->>'dispo'));
          END IF;
          IF (old_line->>'quoted_premium') IS DISTINCT FROM (new_line->>'quoted_premium') THEN
            INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
            VALUES (NEW.id, tbl, uid, 'line_premium_changed',
              jsonb_build_object('line_id', v_line_id, 'type', v_type,
                'from', old_line->>'quoted_premium', 'to', new_line->>'quoted_premium'));
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
