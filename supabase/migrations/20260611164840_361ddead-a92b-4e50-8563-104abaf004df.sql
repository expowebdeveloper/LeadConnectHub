create index if not exists list_leads_first_name_trgm
  on public.list_leads using gin (first_name gin_trgm_ops);
create index if not exists list_leads_last_name_trgm
  on public.list_leads using gin (last_name gin_trgm_ops);

create or replace function public.fuzzy_list_lead_ids(q text, lim int default 25)
returns table (id uuid, score real)
language sql
stable
security invoker
set search_path = public
as $$
  with tokens as (
    select unnest(regexp_split_to_array(trim(coalesce(q,'')), '\s+')) as tok
  ),
  filtered as (
    select tok from tokens where length(tok) >= 2
  )
  select l.id,
         greatest(
           coalesce(max(similarity(lower(l.first_name), lower(f.tok))), 0),
           coalesce(max(similarity(lower(l.last_name),  lower(f.tok))), 0)
         )::real as score
  from public.list_leads l
  cross join filtered f
  where l.archived_at is null
    and (
      lower(l.first_name) % lower(f.tok)
      or lower(l.last_name)  % lower(f.tok)
    )
  group by l.id
  order by score desc
  limit greatest(lim, 1)
$$;

grant execute on function public.fuzzy_list_lead_ids(text, int) to authenticated, service_role;