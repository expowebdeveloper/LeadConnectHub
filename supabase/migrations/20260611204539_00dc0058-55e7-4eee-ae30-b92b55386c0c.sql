CREATE OR REPLACE FUNCTION public.lead_lines_sold_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  new_line jsonb;
  old_line jsonb;
  old_dispo text;
  new_dispo text;
  v_line_id text;
  v_type text;
  v_premium numeric;
  v_items integer;
  v_agent uuid;
  updated_lines jsonb := '[]'::jsonb;
  mutated boolean := false;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.lead_lines IS NULL OR jsonb_typeof(NEW.lead_lines) <> 'array' THEN RETURN NEW; END IF;

  FOR new_line IN SELECT * FROM jsonb_array_elements(NEW.lead_lines)
  LOOP
    v_line_id := new_line->>'line_id';
    v_type    := new_line->>'type';
    new_dispo := new_line->>'dispo';
    old_dispo := NULL;
    old_line  := NULL;

    IF OLD.lead_lines IS NOT NULL AND jsonb_typeof(OLD.lead_lines) = 'array' THEN
      SELECT elem INTO old_line
      FROM jsonb_array_elements(OLD.lead_lines) elem
      WHERE elem->>'line_id' = v_line_id
      LIMIT 1;
      old_dispo := old_line->>'dispo';
    END IF;

    IF new_dispo = 'sold' AND (old_dispo IS DISTINCT FROM 'sold') THEN
      v_premium := NULLIF(new_line->>'quoted_premium','')::numeric;
      v_items := NULLIF(new_line->>'items','')::integer;
      IF v_items IS NULL THEN v_items := 1; END IF;

      -- Credit the agent who actually claimed this line; fall back to the
      -- session user only when the line has no owner recorded.
      v_agent := COALESCE(NULLIF(new_line->>'claimed_by','')::uuid, v_actor);

      PERFORM public.notify_sale_event(
        NEW.id, TG_TABLE_NAME, v_type,
        v_agent,
        v_premium, NEW.first_name, NEW.last_name, GREATEST(v_items, 1)
      );

      IF (new_line->>'sold_at') IS NULL THEN
        new_line := jsonb_set(new_line, '{sold_at}', to_jsonb(now()::text), true);
        mutated := true;
      END IF;
    END IF;

    updated_lines := updated_lines || new_line;
  END LOOP;

  IF mutated THEN
    NEW.lead_lines := updated_lines;
  END IF;

  RETURN NEW;
END;
$function$;