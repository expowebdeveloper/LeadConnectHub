
-- 1) Add archived_at to leads to support daily archival of claimed leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_leads_archived_at
  ON public.leads (archived_at)
  WHERE archived_at IS NOT NULL;

-- 2) Daily archival + missed-transfer mover
CREATE OR REPLACE FUNCTION public.daily_archive_and_move_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Move unclaimed leads older than 24h into list_leads as 'missed_transfer'
  -- ON CONFLICT (phone) DO NOTHING handles list_leads.phone unique constraint
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
    AND created_at < (now() - interval '24 hours')
  ON CONFLICT (phone) DO NOTHING;

  -- Remove the moved unclaimed leads from the live leads table
  DELETE FROM public.leads
  WHERE claimed_by IS NULL
    AND archived_at IS NULL
    AND created_at < (now() - interval '24 hours');

  -- Archive claimed leads older than 24h (kept in leads table, hidden by default)
  UPDATE public.leads
  SET archived_at = now()
  WHERE claimed_by IS NOT NULL
    AND archived_at IS NULL
    AND created_at < (now() - interval '24 hours');
END;
$$;

-- 3) Schedule daily at 07:00 UTC (≈ end of US business day window)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('daily-archive-and-move-leads');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-archive-and-move-leads',
  '0 7 * * *',
  $$ SELECT public.daily_archive_and_move_leads(); $$
);
