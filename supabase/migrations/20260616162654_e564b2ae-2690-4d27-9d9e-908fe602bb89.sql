CREATE OR REPLACE FUNCTION public.is_lead_claimer(_lead_id uuid, _lead_table text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_auto uuid;
  c_home uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _lead_table = 'leads' THEN
    SELECT claimed_by, home_claimed_by INTO c_auto, c_home
      FROM public.leads WHERE id = _lead_id;
  ELSIF _lead_table = 'list_leads' THEN
    SELECT claimed_by, home_claimed_by INTO c_auto, c_home
      FROM public.list_leads WHERE id = _lead_id;
  ELSE
    RETURN false;
  END IF;
  RETURN (c_auto = _user_id) OR (c_home = _user_id);
END;
$function$;