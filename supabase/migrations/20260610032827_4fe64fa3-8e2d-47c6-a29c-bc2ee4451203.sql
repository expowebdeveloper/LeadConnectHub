
ALTER TABLE public.sale_events ADD COLUMN IF NOT EXISTS source text;

CREATE OR REPLACE FUNCTION public._format_list_type(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN t IS NULL OR length(trim(t)) = 0 THEN NULL
    ELSE initcap(replace(t, '_', ' '))
  END;
$$;

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
  v_source text;
  v_list_type text;
begin
  if p_agent_id is not null then
    select coalesce(full_name, email), avatar_url
      into v_agent_name, v_agent_avatar
      from public.profiles where id = p_agent_id;
  end if;

  if p_lead_table = 'leads' then
    v_source := 'Live';
  elsif p_lead_table = 'list_leads' then
    select list_type into v_list_type
      from public.list_leads where id = p_lead_id;
    v_source := coalesce(public._format_list_type(v_list_type), 'List');
  end if;

  insert into public.sale_events (
    lead_id, lead_table, side, agent_id, agent_name, agent_avatar_url,
    lead_name, premium, items_count, source
  )
  values (
    p_lead_id, p_lead_table, p_side, p_agent_id,
    coalesce(v_agent_name, 'An agent'),
    v_agent_avatar,
    nullif(trim(coalesce(p_first,'') || ' ' || coalesce(p_last,'')), ''),
    p_premium,
    greatest(coalesce(p_items, 1), 1),
    v_source
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

UPDATE public.sale_events se
SET source = CASE
  WHEN se.lead_table = 'leads' THEN 'Live'
  WHEN se.lead_table = 'list_leads' THEN COALESCE(
    public._format_list_type((SELECT l.list_type FROM public.list_leads l WHERE l.id = se.lead_id)),
    'List'
  )
  ELSE NULL
END
WHERE source IS NULL;
