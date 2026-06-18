
-- 1. Columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS lead_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Widen sale_events.side check
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_side_check;
ALTER TABLE public.sale_events ADD CONSTRAINT sale_events_side_check
  CHECK (side = ANY (ARRAY['auto','home','motorcycle','boat','umbrella','flood','golf_cart']));

-- 3. Trigger function: diff lead_lines and fire sale events for newly-sold lines
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
  updated_lines jsonb := '[]'::jsonb;
  mutated boolean := false;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_lines IS NULL OR jsonb_typeof(NEW.lead_lines) <> 'array' THEN
    RETURN NEW;
  END IF;

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

      PERFORM public.notify_sale_event(
        NEW.id, TG_TABLE_NAME, v_type,
        COALESCE(v_actor, NULLIF(new_line->>'claimed_by','')::uuid),
        v_premium, NEW.first_name, NEW.last_name
      );

      -- Stamp sold_at on the line if missing
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

DROP TRIGGER IF EXISTS leads_lines_sold_trg ON public.leads;
CREATE TRIGGER leads_lines_sold_trg
  BEFORE UPDATE OF lead_lines ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_lines_sold_trg();

DROP TRIGGER IF EXISTS list_leads_lines_sold_trg ON public.list_leads;
CREATE TRIGGER list_leads_lines_sold_trg
  BEFORE UPDATE OF lead_lines ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_lines_sold_trg();
