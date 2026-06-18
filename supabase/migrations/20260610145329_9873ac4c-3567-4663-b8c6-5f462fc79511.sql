
-- 1. Add no-connect tracking columns to list_leads
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS no_connect_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_no_connect_at timestamptz;

-- 2. Extend the call-tracking trigger to also handle list_leads
CREATE OR REPLACE FUNCTION public.leads_track_no_connect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_outcome text;
  v_tbl text;
BEGIN
  IF NEW.action <> 'call_logged' THEN RETURN NEW; END IF;
  v_tbl := coalesce(NEW.lead_table, '');
  IF v_tbl NOT IN ('leads', 'list_leads') THEN RETURN NEW; END IF;
  v_outcome := coalesce(NEW.details->>'outcome', '');

  IF v_outcome IN ('connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested') THEN
    IF v_tbl = 'leads' THEN
      UPDATE public.leads
        SET no_connect_calls = 0,
            last_no_connect_at = NULL
      WHERE id = NEW.lead_id
        AND (no_connect_calls > 0 OR last_no_connect_at IS NOT NULL);

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
            last_no_connect_at = NULL
      WHERE id = NEW.lead_id
        AND (no_connect_calls > 0 OR last_no_connect_at IS NOT NULL);
    END IF;
  ELSIF v_outcome IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested') THEN
    IF v_tbl = 'leads' THEN
      UPDATE public.leads
        SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
            last_no_connect_at = now()
      WHERE id = NEW.lead_id;
    ELSE
      UPDATE public.list_leads
        SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
            last_no_connect_at = now()
      WHERE id = NEW.lead_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Update list_leads scoring trigger to apply the same no-connect penalty
CREATE OR REPLACE FUNCTION public.list_leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  w jsonb;
  nc_count int;
  nc_recover_per_day numeric;
  nc_days numeric;
  nc_multiplier numeric;
  pre_nc int;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    true,
    coalesce(NEW.list_type, '') = 'aged',
    NEW.list_type
  );

  SELECT weights INTO w FROM public.scoring_weights WHERE id = 1;
  IF w IS NULL THEN w := '{}'::jsonb; END IF;

  pre_nc := r.composite_score;

  nc_count := COALESCE(NEW.no_connect_calls, 0);
  nc_recover_per_day := coalesce((w->>'no_connect_recover_pct_per_day')::numeric, 1);
  IF nc_count > 0 AND NEW.last_no_connect_at IS NOT NULL THEN
    nc_days := EXTRACT(EPOCH FROM (now() - NEW.last_no_connect_at)) / 86400.0;
    nc_multiplier := LEAST(1, GREATEST(0, (nc_days * nc_recover_per_day) / 100.0));
  ELSE
    nc_multiplier := 1;
  END IF;

  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, ROUND(pre_nc * nc_multiplier)::int);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown
    || jsonb_build_object(
         'no_connect_calls', nc_count,
         'no_connect_multiplier', round(nc_multiplier, 3),
         'no_connect_recover_pct_per_day', nc_recover_per_day,
         'pre_no_connect_score', pre_nc
       );
  NEW.scored_at       := now();
  RETURN NEW;
END $function$;
