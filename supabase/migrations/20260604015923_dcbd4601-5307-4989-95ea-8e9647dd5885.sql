
CREATE OR REPLACE FUNCTION public.daily_archive_and_move_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  et_today_start timestamptz;
BEGIN
  -- Start of "today" in Eastern Time, expressed as a UTC timestamp.
  et_today_start := (date_trunc('day', now() AT TIME ZONE 'America/New_York'))
                    AT TIME ZONE 'America/New_York';

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

  UPDATE public.leads
  SET archived_at = now()
  WHERE claimed_by IS NOT NULL
    AND archived_at IS NULL
    AND created_at < et_today_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.daily_archive_and_move_leads() FROM PUBLIC, anon, authenticated;
