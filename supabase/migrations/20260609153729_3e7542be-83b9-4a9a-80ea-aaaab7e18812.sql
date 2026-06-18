
-- Track how many times a lead has been claimed then released back to shark tank.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS release_count integer NOT NULL DEFAULT 0;

-- Increment release_count whenever an agent unclaims a side (claimed -> null).
-- Wrap the existing enforce_lead_claim_transition with the counter bump.
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
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Apply a per-release penalty after the score trigger computes the composite.
-- Penalty: -8 pts per release, capped at -30. Recorded in breakdown.
CREATE OR REPLACE FUNCTION public.leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_releases int;
  v_penalty int;
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
  v_penalty := LEAST(v_releases * 8, 30);

  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, r.composite_score - v_penalty);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown
    || jsonb_build_object('release_count', v_releases, 'release_penalty', v_penalty);
  NEW.scored_at       := now();
  RETURN NEW;
END $function$;

-- Re-score existing rows so penalties take effect immediately.
UPDATE public.leads SET updated_at = now() WHERE release_count > 0;
