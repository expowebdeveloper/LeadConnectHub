
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
        coalesce(v_actor, new.claimed_by), new.quoted_premium, new.first_name, new.last_name);
    end if;
    if new.home_dispo = 'sold' and (old.home_dispo is distinct from new.home_dispo) then
      perform public.notify_sale_event(new.id, tg_table_name, 'home',
        coalesce(v_actor, new.home_claimed_by), new.home_quoted_premium, new.first_name, new.last_name);
    end if;
  end if;
  return new;
end;
$function$;
