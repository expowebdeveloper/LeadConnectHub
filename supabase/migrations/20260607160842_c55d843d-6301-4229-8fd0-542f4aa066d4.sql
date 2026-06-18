ALTER TABLE public.sale_events ADD COLUMN IF NOT EXISTS agent_avatar_url text;

CREATE OR REPLACE FUNCTION public.notify_sale_event(p_lead_id uuid, p_lead_table text, p_side text, p_agent_id uuid, p_premium numeric, p_first text, p_last text)
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

  insert into public.sale_events (lead_id, lead_table, side, agent_id, agent_name, agent_avatar_url, lead_name, premium)
  values (
    p_lead_id, p_lead_table, p_side, p_agent_id,
    coalesce(v_agent_name, 'An agent'),
    v_agent_avatar,
    nullif(trim(coalesce(p_first,'') || ' ' || coalesce(p_last,'')), ''),
    p_premium
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