CREATE OR REPLACE FUNCTION public.prevent_vendor_agent_notes_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'vendor') AND NOT public.has_role(auth.uid(), 'sales') AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.agent_notes IS DISTINCT FROM OLD.agent_notes THEN
      RAISE EXCEPTION 'Sales agent notes are locked and cannot be modified by vendors';
    END IF;
    IF NEW.dispo IS DISTINCT FROM OLD.dispo THEN
      RAISE EXCEPTION 'Dispo is locked and cannot be modified by vendors';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;