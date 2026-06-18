
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS requires_dispo_call_activity_id uuid
    REFERENCES public.lead_activities(id) ON DELETE SET NULL;
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS requires_dispo_call_activity_id uuid
    REFERENCES public.lead_activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_requires_dispo
  ON public.leads(requires_dispo_call_activity_id)
  WHERE requires_dispo_call_activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_list_leads_requires_dispo
  ON public.list_leads(requires_dispo_call_activity_id)
  WHERE requires_dispo_call_activity_id IS NOT NULL;

-- Replace the no-connect tracker so 'initiated' counts immediately, and
-- subsequent terminal outcomes don't double-count the same dial.
CREATE OR REPLACE FUNCTION public.leads_track_no_connect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_outcome text;
  v_tbl text;
  v_recent_initiated boolean := false;
BEGIN
  IF NEW.action <> 'call_logged' THEN RETURN NEW; END IF;
  v_tbl := coalesce(NEW.lead_table, '');
  IF v_tbl NOT IN ('leads', 'list_leads') THEN RETURN NEW; END IF;
  v_outcome := coalesce(NEW.details->>'outcome', '');

  IF v_outcome NOT IN ('initiated','connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested') THEN
    SELECT EXISTS(
      SELECT 1 FROM public.lead_activities
       WHERE lead_id = NEW.lead_id
         AND lead_table = NEW.lead_table
         AND action = 'call_logged'
         AND details->>'outcome' = 'initiated'
         AND created_at > NEW.created_at - interval '1 hour'
         AND id <> NEW.id
    ) INTO v_recent_initiated;
  END IF;

  IF v_outcome IN ('connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested') THEN
    IF v_tbl = 'leads' THEN
      UPDATE public.leads
        SET no_connect_calls = 0,
            last_no_connect_at = NULL,
            requires_dispo_call_activity_id = NEW.id
      WHERE id = NEW.lead_id;

      IF NEW.user_id IS NOT NULL THEN
        UPDATE public.leads
          SET claimed_by = NEW.user_id,
              claimed_at = now()
        WHERE id = NEW.lead_id
          AND claimed_by IS NULL
          AND archived_at IS NULL;
      END IF;
    ELSE
      UPDATE public.list_leads
        SET no_connect_calls = 0,
            last_no_connect_at = NULL,
            requires_dispo_call_activity_id = NEW.id
      WHERE id = NEW.lead_id;
    END IF;
  ELSIF v_outcome = 'initiated' THEN
    IF v_tbl = 'leads' THEN
      UPDATE public.leads
        SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
            last_no_connect_at = now(),
            requires_dispo_call_activity_id = NEW.id
      WHERE id = NEW.lead_id;
    ELSE
      UPDATE public.list_leads
        SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
            last_no_connect_at = now(),
            requires_dispo_call_activity_id = NEW.id
      WHERE id = NEW.lead_id;
    END IF;
  ELSIF v_outcome IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested') THEN
    IF v_recent_initiated THEN
      -- The initiated row already bumped the counter; just refresh timestamp + dispo flag.
      IF v_tbl = 'leads' THEN
        UPDATE public.leads
          SET last_no_connect_at = now(),
              requires_dispo_call_activity_id = NEW.id
        WHERE id = NEW.lead_id;
      ELSE
        UPDATE public.list_leads
          SET last_no_connect_at = now(),
              requires_dispo_call_activity_id = NEW.id
        WHERE id = NEW.lead_id;
      END IF;
    ELSE
      IF v_tbl = 'leads' THEN
        UPDATE public.leads
          SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
              last_no_connect_at = now(),
              requires_dispo_call_activity_id = NEW.id
        WHERE id = NEW.lead_id;
      ELSE
        UPDATE public.list_leads
          SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
              last_no_connect_at = now(),
              requires_dispo_call_activity_id = NEW.id
        WHERE id = NEW.lead_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Auto-clear the "owes dispo" flag the moment a real dispo is recorded.
CREATE OR REPLACE FUNCTION public.clear_requires_dispo_on_dispo_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.dispo IS DISTINCT FROM OLD.dispo AND NEW.dispo IS NOT NULL)
     OR (NEW.home_dispo IS DISTINCT FROM OLD.home_dispo AND NEW.home_dispo IS NOT NULL) THEN
    NEW.requires_dispo_call_activity_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS clear_requires_dispo_leads ON public.leads;
CREATE TRIGGER clear_requires_dispo_leads
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.clear_requires_dispo_on_dispo_change();

DROP TRIGGER IF EXISTS clear_requires_dispo_list_leads ON public.list_leads;
CREATE TRIGGER clear_requires_dispo_list_leads
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.clear_requires_dispo_on_dispo_change();

-- Sweep stale "initiated" call rows older than 30 min with no terminal follow-up.
CREATE OR REPLACE FUNCTION public.finalize_stale_initiated_calls()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.lead_id, a.lead_table, a.details, a.created_at
      FROM public.lead_activities a
     WHERE a.action = 'call_logged'
       AND a.details->>'outcome' = 'initiated'
       AND coalesce((a.details->>'auto_finalized')::boolean, false) = false
       AND a.created_at < now() - interval '30 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.lead_activities b
          WHERE b.lead_id = a.lead_id
            AND b.lead_table = a.lead_table
            AND b.created_at > a.created_at
            AND (
              (b.action = 'call_logged' AND b.details->>'outcome' <> 'initiated')
              OR b.action = 'dispo_changed'
            )
       )
  LOOP
    UPDATE public.lead_activities
       SET details = coalesce(details, '{}'::jsonb)
         || jsonb_build_object('outcome','no_answer','auto_finalized', true, 'originally_outcome','initiated')
     WHERE id = r.id;

    IF r.lead_table = 'leads' THEN
      UPDATE public.leads
         SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
             last_no_connect_at = r.created_at,
             requires_dispo_call_activity_id = coalesce(requires_dispo_call_activity_id, r.id),
             updated_at = now()
       WHERE id = r.lead_id;
    ELSE
      UPDATE public.list_leads
         SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
             last_no_connect_at = r.created_at,
             requires_dispo_call_activity_id = coalesce(requires_dispo_call_activity_id, r.id),
             updated_at = now()
       WHERE id = r.lead_id;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

-- Schedule the sweeper (idempotent: unschedule any prior version first).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'finalize_stale_initiated_calls';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'finalize_stale_initiated_calls',
  '*/5 * * * *',
  $$ SELECT public.finalize_stale_initiated_calls(); $$
);

-- Backfill all historical un-finalized initiated calls (incl. Maria Garay).
SELECT public.finalize_stale_initiated_calls();
