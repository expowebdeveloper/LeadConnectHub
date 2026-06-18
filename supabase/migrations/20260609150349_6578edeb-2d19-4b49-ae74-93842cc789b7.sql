
-- 1. Repair: unarchive leads that are still active work
UPDATE public.leads
SET archived_at = NULL
WHERE archived_at IS NOT NULL
  AND claimed_by IS NOT NULL
  AND (
    dispo IS NULL
    OR dispo::text NOT IN ('sold','dead','not_quoted','already_has_allstate','do_not_call','wrong_number')
    OR follow_up_at IS NOT NULL
    OR x_date IS NOT NULL
    OR home_dispo IS NOT NULL
    OR home_follow_up_at IS NOT NULL
    OR home_x_date IS NOT NULL
  );

-- 2. Fix the daily job: only archive truly finished claimed leads
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

  -- Only archive claimed leads that are truly done — never archive active work.
  -- A lead is "done" when BOTH sides are in a terminal dispo (or the side is unused)
  -- AND there is no pending follow-up or X-date on either side.
  UPDATE public.leads
  SET archived_at = now()
  WHERE claimed_by IS NOT NULL
    AND archived_at IS NULL
    AND created_at < et_today_start
    AND (dispo IS NULL OR dispo::text IN ('sold','dead','not_quoted','already_has_allstate','do_not_call','wrong_number'))
    AND (home_dispo IS NULL OR home_dispo::text IN ('sold','dead','not_quoted','already_has_allstate','do_not_call','wrong_number'))
    AND follow_up_at IS NULL
    AND home_follow_up_at IS NULL
    AND x_date IS NULL
    AND home_x_date IS NULL;
END;
$function$;
