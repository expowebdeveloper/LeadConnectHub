CREATE OR REPLACE FUNCTION public.fuzzy_lead_ids(q text, lim integer DEFAULT 25)
RETURNS TABLE(id uuid, score real)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
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
  from public.leads l
  cross join filtered f
  where l.archived_at is null
    and (
      lower(l.first_name) % lower(f.tok)
      or lower(l.last_name)  % lower(f.tok)
    )
  group by l.id
  order by score desc
  limit greatest(lim, 1)
$function$;

GRANT EXECUTE ON FUNCTION public.fuzzy_lead_ids(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuzzy_lead_ids(text, integer) TO service_role;