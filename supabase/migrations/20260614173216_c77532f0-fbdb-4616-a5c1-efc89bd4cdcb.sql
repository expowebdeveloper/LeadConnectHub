-- Drop existing cron-bound function so we can rebuild it cleanly.
DROP FUNCTION IF EXISTS public.finalize_stale_initiated_calls();

CREATE FUNCTION public.finalize_stale_initiated_calls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '30 minutes';
BEGIN
  UPDATE public.lead_activities a
  SET details = jsonb_set(
        COALESCE(a.details, '{}'::jsonb),
        '{outcome}',
        '"no_answer"'
      ) || jsonb_build_object('auto_finalized', true)
  WHERE a.action = 'call_logged'
    AND a.created_at < v_cutoff
    AND COALESCE(a.details->>'outcome', '') = 'initiated'
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_activities a2
      WHERE a2.lead_id = a.lead_id
        AND a2.user_id = a.user_id
        AND a2.action = 'call_logged'
        AND a2.created_at > a.created_at
        AND a2.created_at <= a.created_at + interval '30 minutes'
        AND COALESCE(a2.details->>'outcome','') IN
          ('voicemail','busy','no_answer','connected','connected_qualified','connected_unqualified')
    );

  UPDATE public.leads
  SET updated_at = now()
  WHERE id IN (
    SELECT DISTINCT lead_id FROM public.lead_activities
    WHERE action = 'call_logged'
      AND created_at < v_cutoff
      AND (details->>'auto_finalized')::boolean IS TRUE
      AND lead_table = 'leads'
  );
  UPDATE public.list_leads
  SET updated_at = now()
  WHERE id IN (
    SELECT DISTINCT lead_id FROM public.lead_activities
    WHERE action = 'call_logged'
      AND created_at < v_cutoff
      AND (details->>'auto_finalized')::boolean IS TRUE
      AND lead_table = 'list_leads'
  );

  UPDATE public.leads l
  SET requires_dispo_call_activity_id = NULL
  WHERE l.requires_dispo_call_activity_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.lead_activities a
      WHERE a.id = l.requires_dispo_call_activity_id
        AND a.created_at < v_cutoff
    );
  UPDATE public.list_leads l
  SET requires_dispo_call_activity_id = NULL
  WHERE l.requires_dispo_call_activity_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.lead_activities a
      WHERE a.id = l.requires_dispo_call_activity_id
        AND a.created_at < v_cutoff
    );
END;
$$;

-- One-shot cleanup so reloads stop popping the dialog for old calls.
UPDATE public.leads l
SET requires_dispo_call_activity_id = NULL
WHERE l.requires_dispo_call_activity_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.lead_activities a
    WHERE a.id = l.requires_dispo_call_activity_id
      AND a.created_at < now() - interval '30 minutes'
  );

UPDATE public.list_leads l
SET requires_dispo_call_activity_id = NULL
WHERE l.requires_dispo_call_activity_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.lead_activities a
    WHERE a.id = l.requires_dispo_call_activity_id
      AND a.created_at < now() - interval '30 minutes'
  );