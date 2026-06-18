
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_released_at timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_lead_claim_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NOT NULL AND OLD.claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'This lead (auto) is already claimed by another agent';
      END IF;
      IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NULL AND OLD.claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'Only the agent who claimed the auto side can release it';
      END IF;
    END IF;
    IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NULL THEN
      NEW.release_count := COALESCE(OLD.release_count, 0) + 1;
      NEW.last_released_at := now();
    END IF;
  END IF;

  IF NEW.home_claimed_by IS DISTINCT FROM OLD.home_claimed_by THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF OLD.home_claimed_by IS NOT NULL AND NEW.home_claimed_by IS NOT NULL AND OLD.home_claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'The home side of this lead is already claimed by another agent';
      END IF;
      IF OLD.home_claimed_by IS NOT NULL AND NEW.home_claimed_by IS NULL AND OLD.home_claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'Only the agent who claimed the home side can release it';
      END IF;
    END IF;
    IF NEW.home_claimed_by IS NULL THEN
      NEW.home_claimed_at := NULL;
    ELSE
      NEW.home_claimed_at := now();
    END IF;
    IF OLD.home_claimed_by IS NOT NULL AND NEW.home_claimed_by IS NULL THEN
      NEW.release_count := COALESCE(NEW.release_count, OLD.release_count, 0) + 1;
      NEW.last_released_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Penalty decays linearly to 0 over 14 days since last release.
CREATE OR REPLACE FUNCTION public.leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_releases int;
  v_base int;
  v_decay numeric;
  v_penalty int;
  v_days numeric;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    false,
    coalesce(NEW.lead_source, '') = 'aged'
  );

  v_releases := COALESCE(NEW.release_count, 0);
  v_base := LEAST(v_releases * 8, 30);
  IF v_releases > 0 AND NEW.last_released_at IS NOT NULL THEN
    v_days := EXTRACT(EPOCH FROM (now() - NEW.last_released_at)) / 86400.0;
    v_decay := GREATEST(0, 1 - (v_days / 14.0));
  ELSE
    v_decay := CASE WHEN v_releases > 0 THEN 1 ELSE 0 END;
  END IF;
  v_penalty := ROUND(v_base * v_decay)::int;

  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, r.composite_score - v_penalty);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown
    || jsonb_build_object(
         'release_count', v_releases,
         'release_penalty', v_penalty,
         'release_penalty_base', v_base,
         'release_penalty_decay', round(v_decay, 2)
       );
  NEW.scored_at       := now();
  RETURN NEW;
END $function$;

UPDATE public.leads SET updated_at = now() WHERE release_count > 0;
