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

  -- Move unclaimed, untouched leads from prior days into list_leads
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

  -- Auto-archiving of claimed leads is intentionally disabled.
  -- Leads stay visible on Live Leads until manually archived.
END;
$function$;