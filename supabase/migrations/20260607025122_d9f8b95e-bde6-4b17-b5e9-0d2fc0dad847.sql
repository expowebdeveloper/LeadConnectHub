create table if not exists public.sale_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  lead_table text not null check (lead_table in ('leads','list_leads')),
  side text not null check (side in ('auto','home')),
  agent_id uuid references auth.users(id) on delete set null,
  agent_name text,
  lead_name text,
  premium numeric,
  created_at timestamptz not null default now()
);

grant select on public.sale_events to authenticated;
grant all on public.sale_events to service_role;

alter table public.sale_events enable row level security;

drop policy if exists "Authenticated read sale_events" on public.sale_events;
create policy "Authenticated read sale_events"
  on public.sale_events for select
  to authenticated
  using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sale_events'
  ) then
    execute 'alter publication supabase_realtime add table public.sale_events';
  end if;
end $$;

create index if not exists sale_events_created_at_idx on public.sale_events (created_at desc);
create index if not exists sale_events_agent_id_idx on public.sale_events (agent_id);

insert into public.app_settings (key, value)
values (
  'sale_webhook',
  jsonb_build_object(
    'url', 'https://jet-leads.lovable.app/api/public/sale-notify',
    'secret', encode(gen_random_bytes(32), 'hex')
  )
)
on conflict (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do nothing;

create or replace function public.notify_sale_event(
  p_lead_id uuid,
  p_lead_table text,
  p_side text,
  p_agent_id uuid,
  p_premium numeric,
  p_first text,
  p_last text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_name text;
  v_event_id uuid;
  v_url text;
  v_secret text;
begin
  if p_agent_id is not null then
    select coalesce(full_name, email) into v_agent_name from public.profiles where id = p_agent_id;
  end if;

  insert into public.sale_events (lead_id, lead_table, side, agent_id, agent_name, lead_name, premium)
  values (
    p_lead_id, p_lead_table, p_side, p_agent_id,
    coalesce(v_agent_name, 'An agent'),
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
$$;

create or replace function public.leads_on_sold_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.dispo = 'sold' and (old.dispo is distinct from new.dispo) then
      perform public.notify_sale_event(new.id, tg_table_name, 'auto',
        new.claimed_by, new.quoted_premium, new.first_name, new.last_name);
    end if;
    if new.home_dispo = 'sold' and (old.home_dispo is distinct from new.home_dispo) then
      perform public.notify_sale_event(new.id, tg_table_name, 'home',
        new.home_claimed_by, new.home_quoted_premium, new.first_name, new.last_name);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_on_sold_aiu on public.leads;
create trigger leads_on_sold_aiu
  after update on public.leads
  for each row execute function public.leads_on_sold_trg();

drop trigger if exists list_leads_on_sold_aiu on public.list_leads;
create trigger list_leads_on_sold_aiu
  after update on public.list_leads
  for each row execute function public.leads_on_sold_trg();