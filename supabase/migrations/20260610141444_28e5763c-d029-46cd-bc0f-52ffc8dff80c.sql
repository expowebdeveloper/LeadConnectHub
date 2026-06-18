
INSERT INTO public.scoring_weights (id, weights)
VALUES (1, jsonb_build_object('no_connect_recover_pct_per_day', 1))
ON CONFLICT (id) DO UPDATE
SET weights = public.scoring_weights.weights
  || jsonb_build_object(
       'no_connect_recover_pct_per_day',
       coalesce((public.scoring_weights.weights->>'no_connect_recover_pct_per_day')::numeric, 1)
     );

CREATE OR REPLACE FUNCTION public.leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  w jsonb;
  v_releases int;
  v_per int;
  v_cap int;
  v_window numeric;
  v_base int;
  v_decay numeric;
  v_penalty int;
  v_days numeric;
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
    false,
    coalesce(NEW.lead_source, '') = 'aged'
  );

  SELECT weights INTO w FROM public.scoring_weights WHERE id = 1;
  IF w IS NULL THEN w := '{}'::jsonb; END IF;
  v_per    := coalesce((w->>'release_penalty_per')::int, 8);
  v_cap    := coalesce((w->>'release_penalty_cap')::int, 30);
  v_window := coalesce((w->>'release_penalty_decay_days')::numeric, 180);

  v_releases := COALESCE(NEW.release_count, 0);
  v_base := LEAST(v_releases * v_per, v_cap);
  IF v_releases > 0 AND NEW.last_released_at IS NOT NULL AND v_window > 0 THEN
    v_days := EXTRACT(EPOCH FROM (now() - NEW.last_released_at)) / 86400.0;
    v_decay := GREATEST(0, 1 - (v_days / v_window));
  ELSE
    v_decay := CASE WHEN v_releases > 0 THEN 1 ELSE 0 END;
  END IF;
  v_penalty := ROUND(v_base * v_decay)::int;

  pre_nc := GREATEST(0, r.composite_score - v_penalty);

  -- Percentage-based no-connect penalty: 100% reduction, recovers per_day % each day
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
         'release_count', v_releases,
         'release_penalty', v_penalty,
         'release_penalty_base', v_base,
         'release_penalty_decay', round(v_decay, 2),
         'no_connect_calls', nc_count,
         'no_connect_multiplier', round(nc_multiplier, 3),
         'no_connect_recover_pct_per_day', nc_recover_per_day,
         'pre_no_connect_score', pre_nc
       );
  NEW.scored_at       := now();
  RETURN NEW;
END $function$;

-- Refire score trigger
UPDATE public.leads SET updated_at = now() WHERE id IS NOT NULL;
