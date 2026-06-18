
ALTER TABLE public.sale_events ADD COLUMN IF NOT EXISTS items_count integer;

-- Updated notify_sale_event with items
CREATE OR REPLACE FUNCTION public.notify_sale_event(
  p_lead_id uuid, p_lead_table text, p_side text, p_agent_id uuid,
  p_premium numeric, p_first text, p_last text, p_items integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_agent_name text;
  v_agent_avatar text;
  v_event_id uuid;
  v_url text;
  v_secret text;
begin
  if p_agent_id is not null then
    select coalesce(full_name, email), avatar_url
      into v_agent_name, v_agent_avatar
      from public.profiles where id = p_agent_id;
  end if;

  insert into public.sale_events (lead_id, lead_table, side, agent_id, agent_name, agent_avatar_url, lead_name, premium, items_count)
  values (
    p_lead_id, p_lead_table, p_side, p_agent_id,
    coalesce(v_agent_name, 'An agent'),
    v_agent_avatar,
    nullif(trim(coalesce(p_first,'') || ' ' || coalesce(p_last,'')), ''),
    p_premium,
    greatest(coalesce(p_items, 1), 1)
  )
  returning id into v_event_id;

  select value->>'url', value->>'secret'
  into v_url, v_secret
  from public.app_settings
  where key = 'sale_webhook'
  limit 1;

  if v_url is not null and v_secret is not null then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('event_id', v_event_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Sale-Secret', v_secret
      )
    );
  end if;
end;
$function$;

-- Auto/home trigger: pass num_vehicles for auto, 1 for home
CREATE OR REPLACE FUNCTION public.leads_on_sold_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if new.dispo = 'sold' and (old.dispo is distinct from new.dispo) then
      perform public.notify_sale_event(new.id, tg_table_name, 'auto',
        coalesce(v_actor, new.claimed_by), new.quoted_premium, new.first_name, new.last_name,
        greatest(coalesce(new.num_vehicles, 1), 1));
    end if;
    if new.home_dispo = 'sold' and (old.home_dispo is distinct from new.home_dispo) then
      perform public.notify_sale_event(new.id, tg_table_name, 'home',
        coalesce(v_actor, new.home_claimed_by), new.home_quoted_premium, new.first_name, new.last_name,
        1);
    end if;
  end if;
  return new;
end;
$function$;

-- Extra lines trigger: read optional "items" field from line, default 1
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

      PERFORM public.notify_sale_event(
        NEW.id, TG_TABLE_NAME, v_type,
        COALESCE(v_actor, NULLIF(new_line->>'claimed_by','')::uuid),
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

-- Backfill existing rows: auto = lead num_vehicles; everything else = 1
UPDATE public.sale_events se
SET items_count = COALESCE(
  CASE WHEN se.side = 'auto' AND se.lead_table = 'leads'
       THEN (SELECT GREATEST(COALESCE(l.num_vehicles,1),1) FROM public.leads l WHERE l.id = se.lead_id)
       WHEN se.side = 'auto' AND se.lead_table = 'list_leads'
       THEN (SELECT GREATEST(COALESCE(l.num_vehicles,1),1) FROM public.list_leads l WHERE l.id = se.lead_id)
       ELSE 1
  END, 1)
WHERE items_count IS NULL;
