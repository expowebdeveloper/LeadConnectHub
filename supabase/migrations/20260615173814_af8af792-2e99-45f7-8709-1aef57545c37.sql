DROP FUNCTION IF EXISTS public.finalize_stale_initiated_calls();

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
       AND a.created_at < now() - interval '10 minutes'
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

REVOKE EXECUTE ON FUNCTION public.finalize_stale_initiated_calls() FROM anon, public;