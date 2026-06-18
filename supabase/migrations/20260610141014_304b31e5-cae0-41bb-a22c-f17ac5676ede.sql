
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS no_connect_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_no_connect_at timestamptz;

-- Trigger fn: maintain no-connect counters from lead_activities
CREATE OR REPLACE FUNCTION public.leads_track_no_connect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.action <> 'call_logged' THEN RETURN NEW; END IF;
  IF coalesce(NEW.lead_table, '') <> 'leads' THEN RETURN NEW; END IF;
  v_outcome := coalesce(NEW.details->>'outcome', '');

  IF v_outcome IN ('connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested') THEN
    UPDATE public.leads
      SET no_connect_calls = 0,
          last_no_connect_at = NULL
    WHERE id = NEW.lead_id
      AND (no_connect_calls > 0 OR last_no_connect_at IS NOT NULL);
  ELSIF v_outcome IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested') THEN
    UPDATE public.leads
      SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
          last_no_connect_at = now()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_activities_no_connect_trg ON public.lead_activities;
CREATE TRIGGER lead_activities_no_connect_trg
AFTER INSERT ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.leads_track_no_connect();

-- Default scoring weights
INSERT INTO public.scoring_weights (id, weights)
VALUES (1, jsonb_build_object(
  'no_connect_penalty_per', 12,
  'no_connect_penalty_cap', 60,
  'no_connect_decay_days', 7
))
ON CONFLICT (id) DO UPDATE
SET weights = public.scoring_weights.weights
  || jsonb_build_object(
       'no_connect_penalty_per', coalesce(public.scoring_weights.weights->>'no_connect_penalty_per', '12')::int,
       'no_connect_penalty_cap', coalesce(public.scoring_weights.weights->>'no_connect_penalty_cap', '60')::int,
       'no_connect_decay_days', coalesce(public.scoring_weights.weights->>'no_connect_decay_days', '7')::int
     );

-- Update live-lead score trigger to include the no-connect penalty
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
  nc_per int;
  nc_cap int;
  nc_window numeric;
  nc_base int;
  nc_decay numeric;
  nc_penalty int;
  nc_days numeric;
  nc_count int;
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

  nc_per    := coalesce((w->>'no_connect_penalty_per')::int, 12);
  nc_cap    := coalesce((w->>'no_connect_penalty_cap')::int, 60);
  nc_window := coalesce((w->>'no_connect_decay_days')::numeric, 7);
  nc_count  := COALESCE(NEW.no_connect_calls, 0);
  nc_base   := LEAST(nc_count * nc_per, nc_cap);
  IF nc_count > 0 AND NEW.last_no_connect_at IS NOT NULL AND nc_window > 0 THEN
    nc_days  := EXTRACT(EPOCH FROM (now() - NEW.last_no_connect_at)) / 86400.0;
    nc_decay := GREATEST(0, 1 - (nc_days / nc_window));
  ELSE
    nc_decay := CASE WHEN nc_count > 0 THEN 1 ELSE 0 END;
  END IF;
  nc_penalty := ROUND(nc_base * nc_decay)::int;

  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, r.composite_score - v_penalty - nc_penalty);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown
    || jsonb_build_object(
         'release_count', v_releases,
         'release_penalty', v_penalty,
         'release_penalty_base', v_base,
         'release_penalty_decay', round(v_decay, 2),
         'no_connect_calls', nc_count,
         'no_connect_penalty', nc_penalty,
         'no_connect_penalty_base', nc_base,
         'no_connect_penalty_decay', round(nc_decay, 2)
       );
  NEW.scored_at       := now();
  RETURN NEW;
END $function$;

-- Backfill counters from existing activity history
WITH agg AS (
  SELECT
    la.lead_id,
    COUNT(*) FILTER (
      WHERE (la.details->>'outcome') IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested')
        AND la.created_at > COALESCE((
          SELECT MAX(la2.created_at) FROM public.lead_activities la2
          WHERE la2.lead_id = la.lead_id
            AND la2.lead_table = 'leads'
            AND la2.action = 'call_logged'
            AND (la2.details->>'outcome') IN ('connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested')
        ), 'epoch'::timestamptz)
    ) AS nc_count,
    MAX(la.created_at) FILTER (
      WHERE (la.details->>'outcome') IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested')
    ) AS nc_last
  FROM public.lead_activities la
  WHERE la.lead_table = 'leads' AND la.action = 'call_logged'
  GROUP BY la.lead_id
)
UPDATE public.leads l
SET no_connect_calls = COALESCE(agg.nc_count, 0),
    last_no_connect_at = CASE WHEN COALESCE(agg.nc_count, 0) > 0 THEN agg.nc_last ELSE NULL END
FROM agg
WHERE l.id = agg.lead_id;

-- Refire score trigger across leads
UPDATE public.leads SET updated_at = now() WHERE id IS NOT NULL;
