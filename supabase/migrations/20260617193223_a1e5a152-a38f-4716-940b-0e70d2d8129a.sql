
-- 1. Update weights
UPDATE public.scoring_weights
SET weights = weights
  || jsonb_build_object(
       'vehicle_per_unit', 40,
       'vehicle_cap', 280,
       'tier_winback_bonus', 0,
       'tier_winback_base', 0,
       'tier_winback_per_vehicle', 0,
       'tier_requote_bonus', 0,
       'recent_contact_bonus', 35,
       'recent_contact_days', 3
     ),
    updated_at = now()
WHERE id = 1;

-- 2. leads_score_trg with recent_contact_bonus
CREATE OR REPLACE FUNCTION public.leads_score_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record; w jsonb;
  v_releases int; v_per int; v_cap int; v_window numeric;
  v_base int; v_decay numeric; v_penalty int; v_days numeric;
  nc_count int; nc_recover_per_day numeric; nc_days numeric; nc_multiplier numeric; pre_nc int;
  rc_bonus int := 0; rc_max int; rc_days numeric; rc_age_days numeric := -1;
  last_touch timestamptz;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    false, coalesce(NEW.lead_source, '') = 'aged', NULL,
    NEW.construction_type, NEW.roof_year, NEW.roof_type, NEW.flood_zone,
    NEW.has_pool, NEW.has_trampoline
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
  nc_count := COALESCE(NEW.no_connect_calls, 0);
  nc_recover_per_day := coalesce((w->>'no_connect_recover_pct_per_day')::numeric, 1);
  IF nc_count > 0 AND NEW.last_no_connect_at IS NOT NULL THEN
    nc_days := EXTRACT(EPOCH FROM (now() - NEW.last_no_connect_at)) / 86400.0;
    nc_multiplier := LEAST(1, GREATEST(0, (nc_days * nc_recover_per_day) / 100.0));
  ELSE
    nc_multiplier := 1;
  END IF;
  rc_max  := coalesce((w->>'recent_contact_bonus')::int, 0);
  rc_days := coalesce((w->>'recent_contact_days')::numeric, 3);
  last_touch := GREATEST(NEW.last_no_connect_at, NEW.last_contacted_at);
  IF rc_max > 0 AND rc_days > 0 AND last_touch IS NOT NULL THEN
    rc_age_days := EXTRACT(EPOCH FROM (now() - last_touch)) / 86400.0;
    IF rc_age_days <= rc_days THEN
      rc_bonus := ROUND(rc_max * GREATEST(0, 1 - (rc_age_days / rc_days)))::int;
    END IF;
  END IF;
  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, ROUND(pre_nc * nc_multiplier)::int + rc_bonus);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown || jsonb_build_object(
    'release_count', v_releases, 'release_penalty', v_penalty,
    'release_penalty_base', v_base, 'release_penalty_decay', round(v_decay, 2),
    'no_connect_calls', nc_count, 'no_connect_multiplier', round(nc_multiplier, 3),
    'no_connect_recover_pct_per_day', nc_recover_per_day, 'pre_no_connect_score', pre_nc,
    'recent_contact_bonus', rc_bonus, 'recent_contact_age_days', round(rc_age_days, 2)
  );
  NEW.scored_at := now();
  RETURN NEW;
END $function$;

-- 3. list_leads_score_trg with recent_contact_bonus
CREATE OR REPLACE FUNCTION public.list_leads_score_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record; w jsonb;
  nc_count int; nc_recover_per_day numeric; nc_days numeric; nc_multiplier numeric; pre_nc int;
  rc_bonus int := 0; rc_max int; rc_days numeric; rc_age_days numeric := -1;
  last_touch timestamptz;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    true, coalesce(NEW.list_type, '') = 'aged', NEW.list_type,
    NEW.construction_type, NEW.roof_year, NEW.roof_type, NEW.flood_zone,
    NEW.has_pool, NEW.has_trampoline
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
  rc_max  := coalesce((w->>'recent_contact_bonus')::int, 0);
  rc_days := coalesce((w->>'recent_contact_days')::numeric, 3);
  last_touch := GREATEST(NEW.last_no_connect_at, NEW.last_contacted_at);
  IF rc_max > 0 AND rc_days > 0 AND last_touch IS NOT NULL THEN
    rc_age_days := EXTRACT(EPOCH FROM (now() - last_touch)) / 86400.0;
    IF rc_age_days <= rc_days THEN
      rc_bonus := ROUND(rc_max * GREATEST(0, 1 - (rc_age_days / rc_days)))::int;
    END IF;
  END IF;
  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := GREATEST(0, ROUND(pre_nc * nc_multiplier)::int + rc_bonus);
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown || jsonb_build_object(
    'no_connect_calls', nc_count, 'no_connect_multiplier', round(nc_multiplier, 3),
    'no_connect_recover_pct_per_day', nc_recover_per_day, 'pre_no_connect_score', pre_nc,
    'recent_contact_bonus', rc_bonus, 'recent_contact_age_days', round(rc_age_days, 2)
  );
  NEW.scored_at := now();
  RETURN NEW;
END $function$;

-- 4. last_contacted_at column
ALTER TABLE public.leads      ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- 5. Activity → bump parent
CREATE OR REPLACE FUNCTION public.bump_lead_on_activity()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.action IS NULL OR NEW.action NOT IN (
    'call_attempt','call_connect','no_connect','dial','sms','email','note','contact','call'
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_table = 'list_leads' THEN
    UPDATE public.list_leads
       SET last_contacted_at = GREATEST(coalesce(last_contacted_at, 'epoch'::timestamptz), NEW.created_at),
           updated_at = now()
     WHERE id = NEW.lead_id
       AND NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
       AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL);
  ELSE
    UPDATE public.leads
       SET last_contacted_at = GREATEST(coalesce(last_contacted_at, 'epoch'::timestamptz), NEW.created_at),
           updated_at = now()
     WHERE id = NEW.lead_id
       AND NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
       AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS lead_activities_bump_parent ON public.lead_activities;
CREATE TRIGGER lead_activities_bump_parent
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.bump_lead_on_activity();

-- 6. Backfill last_contacted_at
UPDATE public.list_leads ll
   SET last_contacted_at = GREATEST(
         coalesce(ll.last_contacted_at, 'epoch'::timestamptz),
         coalesce(ll.last_no_connect_at, 'epoch'::timestamptz),
         coalesce(a.last_at, 'epoch'::timestamptz)
       )
  FROM (
    SELECT lead_id, MAX(created_at) AS last_at
      FROM public.lead_activities
     WHERE lead_table = 'list_leads'
     GROUP BY lead_id
  ) a
 WHERE a.lead_id = ll.id
   AND NOT (ll.dispo = 'follow_up' AND ll.follow_up_at IS NULL)
   AND NOT (ll.home_dispo = 'follow_up' AND ll.home_follow_up_at IS NULL);

UPDATE public.leads l
   SET last_contacted_at = GREATEST(
         coalesce(l.last_contacted_at, 'epoch'::timestamptz),
         coalesce(l.last_no_connect_at, 'epoch'::timestamptz),
         coalesce(a.last_at, 'epoch'::timestamptz)
       )
  FROM (
    SELECT lead_id, MAX(created_at) AS last_at
      FROM public.lead_activities
     WHERE lead_table IN ('leads','') OR lead_table IS NULL
     GROUP BY lead_id
  ) a
 WHERE a.lead_id = l.id
   AND NOT (l.dispo = 'follow_up' AND l.follow_up_at IS NULL)
   AND NOT (l.home_dispo = 'follow_up' AND l.home_follow_up_at IS NULL);

-- 7. Broad recompute (skip rows that would violate the follow-up rule)
UPDATE public.list_leads SET updated_at = now()
  WHERE NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
    AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL);

UPDATE public.leads SET updated_at = now()
  WHERE NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
    AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL);
