CREATE OR REPLACE FUNCTION public.daily_archive_and_move_leads()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  et_today_start timestamptz;
BEGIN
  et_today_start := (date_trunc('day', now() AT TIME ZONE 'America/New_York'))
                    AT TIME ZONE 'America/New_York';

  -- Move unclaimed, untouched leads from prior days into list_leads (unchanged behavior)
  INSERT INTO public.list_leads (
    vendor_id, first_name, last_name, phone, email, date_of_birth,
    street, city, state, zip, county, current_carrier, num_vehicles,
    vehicles, vendor_notes, list_type, created_at
  )
  SELECT vendor_id, first_name, last_name, phone, email, date_of_birth,
    street, city, state, zip, county, current_carrier, num_vehicles,
    vehicles, vendor_notes, 'missed_transfer', created_at
  FROM public.leads
  WHERE claimed_by IS NULL
    AND archived_at IS NULL
    AND created_at < et_today_start
  ON CONFLICT (phone) DO NOTHING;

  DELETE FROM public.leads
  WHERE claimed_by IS NULL
    AND archived_at IS NULL
    AND created_at < et_today_start;

  -- Archive completed claimed leads. SOLD leads are intentionally excluded so
  -- recent wins stay visible on the Live Leads board until manually archived.
  UPDATE public.leads
  SET archived_at = now()
  WHERE claimed_by IS NOT NULL
    AND archived_at IS NULL
    AND created_at < et_today_start
    AND (dispo IS NULL OR dispo::text IN ('dead','not_quoted','already_has_allstate','do_not_call','wrong_number'))
    AND (home_dispo IS NULL OR home_dispo::text IN ('dead','not_quoted','already_has_allstate','do_not_call','wrong_number'))
    AND dispo::text IS DISTINCT FROM 'sold'
    AND home_dispo::text IS DISTINCT FROM 'sold'
    AND follow_up_at IS NULL
    AND home_follow_up_at IS NULL
    AND x_date IS NULL
    AND home_x_date IS NULL;
END;
$function$;