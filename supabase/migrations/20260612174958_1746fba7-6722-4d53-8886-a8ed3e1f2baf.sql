
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS flood_zone text;
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS flood_zone text;

CREATE OR REPLACE FUNCTION public.calc_lead_score(
  p_vendor_id uuid, p_phone text, p_email text, p_housing_status text,
  p_num_vehicles integer, p_auto_carrier text, p_home_carrier text,
  p_date_of_birth date, p_created_at timestamp with time zone,
  p_dispo text, p_home_dispo text, p_lead_types text[],
  p_year_built integer, p_square_feet integer, p_dwelling_value numeric,
  p_is_list_source boolean, p_is_aged_source boolean,
  p_list_type text DEFAULT NULL::text,
  p_construction_type text DEFAULT NULL::text,
  p_roof_year integer DEFAULT NULL,
  p_roof_type text DEFAULT NULL::text,
  p_flood_zone text DEFAULT NULL::text,
  p_has_pool boolean DEFAULT NULL,
  p_has_trampoline boolean DEFAULT NULL
)
 RETURNS TABLE(auto_score integer, home_score integer, composite_score integer, score_tier text, breakdown jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w jsonb;
  age_years int; hours_old numeric;
  v_recency int; v_contact int; v_source int; v_engagement int;
  v_age int; v_auto_carrier int; v_home_carrier int;
  v_vehicles int; v_bundling int; v_property int;
  -- home-specific
  v_home_age int := 0; v_home_value int := 0; v_home_roof int := 0;
  v_home_construction int := 0; v_home_flood int := 0;
  v_home_size int := 0; v_home_liability int := 0;
  h_age_max int; h_value_max int; h_roof_max int;
  h_masonry int; h_frame int;
  h_flood_high int; h_flood_low int;
  h_size_max int; h_liability int;
  cur_year int := EXTRACT(YEAR FROM now())::int;
  home_age_years int; roof_age_years int;
  ct text; rt text; fz text;
  auto_total int := 0; home_total int := 0; comp int; tier text := NULL;
  vendor_name text;
  is_ivantage boolean := false; is_allstate boolean := false;
  is_winback boolean := false; is_requote boolean := false; is_aged boolean := false;
  has_auto boolean; has_home boolean;
  explicit_auto boolean := false; explicit_home boolean := false;
  inferred_auto boolean := false; inferred_home boolean := false;
  pts_cheap int; pts_std int; pts_prem int; pts_unk int; pts_none int; pts_nonstd int;
  cheap_l text[]; std_l text[]; prem_l text[]; nonstd_l text[];
  auto_norm text; home_norm text; auto_bucket text; home_bucket text;
  lt text;
  wb_base int; wb_per int; wb_max int; wb_bonus int := 0; nv int; wb_units int := 0;
  veh_per int; veh_cap int;
BEGIN
  SELECT weights INTO w FROM public.scoring_weights WHERE id = 1;
  IF w IS NULL THEN w := '{}'::jsonb; END IF;

  pts_cheap  := coalesce((w->>'carrier_pts_cheap')::int, 5);
  pts_std    := coalesce((w->>'carrier_pts_standard')::int, 10);
  pts_prem   := coalesce((w->>'carrier_pts_premium')::int, 15);
  pts_unk    := coalesce((w->>'carrier_pts_unknown')::int, 8);
  pts_none   := coalesce((w->>'carrier_pts_none')::int, 15);
  pts_nonstd := coalesce((w->>'carrier_pts_nonstandard')::int, 2);

  h_age_max     := coalesce((w->>'home_age_max')::int, 25);
  h_value_max   := coalesce((w->>'home_value_max')::int, 25);
  h_roof_max    := coalesce((w->>'home_roof_max')::int, 15);
  h_masonry     := coalesce((w->>'home_construction_masonry_pts')::int, 10);
  h_frame       := coalesce((w->>'home_construction_frame_pts')::int, 4);
  h_flood_high  := coalesce((w->>'home_flood_high_pts')::int, 8);
  h_flood_low   := coalesce((w->>'home_flood_low_pts')::int, 0);
  h_size_max    := coalesce((w->>'home_size_max')::int, 5);
  h_liability   := coalesce((w->>'home_liability_penalty')::int, 5);

  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO cheap_l  FROM jsonb_array_elements_text(coalesce(w->'carriers_cheap','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO std_l    FROM jsonb_array_elements_text(coalesce(w->'carriers_standard','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO prem_l   FROM jsonb_array_elements_text(coalesce(w->'carriers_premium','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO nonstd_l FROM jsonb_array_elements_text(coalesce(w->'carriers_nonstandard','[]'::jsonb)) x;

  lt := lower(coalesce(p_list_type, ''));
  auto_norm := public.normalize_carrier(p_auto_carrier);
  home_norm := public.normalize_carrier(p_home_carrier);

  explicit_auto := p_lead_types IS NOT NULL AND 'auto' = ANY(p_lead_types);
  explicit_home := p_lead_types IS NOT NULL AND ('home' = ANY(p_lead_types) OR 'renters' = ANY(p_lead_types));
  inferred_auto := coalesce(p_num_vehicles, 0) > 0 OR NULLIF(btrim(coalesce(auto_norm, '')), '') IS NOT NULL;
  inferred_home := NULLIF(btrim(coalesce(home_norm, '')), '') IS NOT NULL
    OR lower(coalesce(p_housing_status, '')) IN ('homeowner', 'renter')
    OR p_year_built IS NOT NULL
    OR p_square_feet IS NOT NULL
    OR p_dwelling_value IS NOT NULL;

  has_auto := explicit_auto OR inferred_auto;
  has_home := explicit_home OR inferred_home;

  hours_old := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p_created_at, now()))) / 3600.0);
  v_recency := CASE
    WHEN p_is_list_source THEN
      CASE
        WHEN hours_old <= 24 THEN 4
        WHEN hours_old <= 168 THEN 3
        WHEN hours_old <= 720 THEN 2
        ELSE 1
      END
    ELSE
      CASE
        WHEN hours_old <= 0.5 THEN 25 WHEN hours_old <= 2 THEN 22
        WHEN hours_old <= 6 THEN 19 WHEN hours_old <= 24 THEN 15
        WHEN hours_old <= 72 THEN 11 WHEN hours_old <= 168 THEN 7
        WHEN hours_old <= 336 THEN 4 WHEN hours_old <= 720 THEN 2 ELSE 0
      END
  END;

  v_contact := 0;
  IF p_phone IS NOT NULL AND length(trim(p_phone)) >= 10 THEN v_contact := v_contact + 5; END IF;
  IF p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$' THEN v_contact := v_contact + 5; END IF;

  v_source := CASE WHEN p_is_list_source THEN 4 ELSE 10 END;

  v_engagement := 0;
  IF p_dispo IS NOT NULL AND p_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 3; END IF;
  IF p_home_dispo IS NOT NULL AND p_home_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 2; END IF;
  IF v_engagement > 5 THEN v_engagement := 5; END IF;

  IF p_date_of_birth IS NULL THEN v_age := 7;
  ELSE
    age_years := EXTRACT(YEAR FROM age(p_date_of_birth))::int;
    v_age := CASE
      WHEN age_years BETWEEN 30 AND 65 THEN 10
      WHEN age_years BETWEEN 25 AND 75 THEN 8
      WHEN age_years BETWEEN 21 AND 80 THEN 6 ELSE 4
    END;
  END IF;

  IF auto_norm IS NULL THEN
    IF explicit_auto THEN v_auto_carrier := pts_none; auto_bucket := 'none';
    ELSIF inferred_auto THEN v_auto_carrier := pts_unk; auto_bucket := 'missing';
    ELSE v_auto_carrier := 0; auto_bucket := 'n/a'; END IF;
  ELSIF lower(auto_norm) = ANY(nonstd_l) THEN v_auto_carrier := pts_nonstd; auto_bucket := 'nonstandard';
  ELSIF lower(auto_norm) = ANY(prem_l)   THEN v_auto_carrier := pts_prem;   auto_bucket := 'premium';
  ELSIF lower(auto_norm) = ANY(std_l)    THEN v_auto_carrier := pts_std;    auto_bucket := 'standard';
  ELSIF lower(auto_norm) = ANY(cheap_l)  THEN v_auto_carrier := pts_cheap;  auto_bucket := 'cheap';
  ELSE v_auto_carrier := pts_unk; auto_bucket := 'unknown';
  END IF;

  IF home_norm IS NULL THEN
    IF explicit_home THEN v_home_carrier := pts_none; home_bucket := 'none';
    ELSIF inferred_home THEN v_home_carrier := pts_unk; home_bucket := 'missing';
    ELSE v_home_carrier := 0; home_bucket := 'n/a'; END IF;
  ELSIF lower(home_norm) = ANY(nonstd_l) THEN v_home_carrier := pts_nonstd; home_bucket := 'nonstandard';
  ELSIF lower(home_norm) = ANY(prem_l)   THEN v_home_carrier := pts_prem;   home_bucket := 'premium';
  ELSIF lower(home_norm) = ANY(std_l)    THEN v_home_carrier := pts_std;    home_bucket := 'standard';
  ELSIF lower(home_norm) = ANY(cheap_l)  THEN v_home_carrier := pts_cheap;  home_bucket := 'cheap';
  ELSE v_home_carrier := pts_unk; home_bucket := 'unknown';
  END IF;

  veh_per := coalesce((w->>'vehicle_per_unit')::int, 15);
  veh_cap := coalesce((w->>'vehicle_cap')::int, 150);
  v_vehicles := LEAST(coalesce(p_num_vehicles, 0) * veh_per, veh_cap);

  v_bundling := CASE WHEN has_auto AND has_home THEN coalesce((w->>'bundling_max')::int,15) ELSE 0 END;
  v_property := 0;
  IF p_year_built IS NOT NULL THEN v_property := v_property + 5; END IF;
  IF p_square_feet IS NOT NULL THEN v_property := v_property + 5; END IF;
  IF p_dwelling_value IS NOT NULL THEN v_property := v_property + 5; END IF;

  -- HOME-SPECIFIC SCORING (property driven, ignores vehicles)
  -- Home age: full pts if <=10y, linear decay to 0 at 80y. Missing => half.
  IF p_year_built IS NOT NULL AND p_year_built BETWEEN 1800 AND cur_year + 1 THEN
    home_age_years := GREATEST(0, cur_year - p_year_built);
    IF home_age_years <= 10 THEN v_home_age := h_age_max;
    ELSIF home_age_years >= 80 THEN v_home_age := 0;
    ELSE v_home_age := ROUND(h_age_max * (1.0 - (home_age_years - 10)::numeric / 70.0))::int;
    END IF;
  ELSE
    v_home_age := h_age_max / 2;
  END IF;

  -- Dwelling value: 0 at <=$150k, linear to full at >=$600k.
  IF p_dwelling_value IS NOT NULL AND p_dwelling_value > 0 THEN
    IF p_dwelling_value >= 600000 THEN v_home_value := h_value_max;
    ELSIF p_dwelling_value <= 150000 THEN v_home_value := 0;
    ELSE v_home_value := ROUND(h_value_max * ((p_dwelling_value - 150000) / 450000.0))::int;
    END IF;
  ELSE
    v_home_value := h_value_max / 2;
  END IF;

  -- Roof recency: full if <=5y, linear to 0 at 30y. Missing => half.
  IF p_roof_year IS NOT NULL AND p_roof_year BETWEEN 1900 AND cur_year + 1 THEN
    roof_age_years := GREATEST(0, cur_year - p_roof_year);
    IF roof_age_years <= 5 THEN v_home_roof := h_roof_max;
    ELSIF roof_age_years >= 30 THEN v_home_roof := 0;
    ELSE v_home_roof := ROUND(h_roof_max * (1.0 - (roof_age_years - 5)::numeric / 25.0))::int;
    END IF;
  ELSE
    v_home_roof := h_roof_max / 2;
  END IF;

  -- Construction: masonry / brick / block / concrete beats frame / wood.
  ct := lower(coalesce(p_construction_type, ''));
  IF ct ~ '(masonry|brick|block|concrete|stucco|cinder)' THEN v_home_construction := h_masonry;
  ELSIF ct ~ '(frame|wood|vinyl|siding)' THEN v_home_construction := h_frame;
  ELSE v_home_construction := (h_masonry + h_frame) / 2;
  END IF;

  -- Flood zone: high-risk (A*, V*) is positive (sells flood premium). X/B/C/D neutral.
  fz := upper(coalesce(p_flood_zone, ''));
  IF fz <> '' THEN
    IF fz LIKE 'A%' OR fz LIKE 'V%' THEN v_home_flood := h_flood_high;
    ELSE v_home_flood := h_flood_low;
    END IF;
  END IF;

  -- Size bump for larger homes.
  IF p_square_feet IS NOT NULL AND p_square_feet >= 2000 THEN
    IF p_square_feet >= 4000 THEN v_home_size := h_size_max;
    ELSE v_home_size := ROUND(h_size_max * ((p_square_feet - 2000)::numeric / 2000.0))::int;
    END IF;
  END IF;

  -- Liability hazards
  IF coalesce(p_has_pool, false) OR coalesce(p_has_trampoline, false) THEN
    v_home_liability := -h_liability;
  END IF;

  IF has_auto THEN auto_total := v_vehicles + v_auto_carrier + v_age + v_recency + v_contact + v_source + v_engagement; END IF;
  IF has_home AND coalesce(p_housing_status,'') <> 'renter' THEN
    home_total := v_home_age + v_home_value + v_home_roof + v_home_construction
                + v_home_flood + v_home_size + v_home_liability
                + v_home_carrier + v_recency + v_contact + v_source;
  END IF;

  auto_total := GREATEST(0, auto_total);
  home_total := GREATEST(0, home_total);
  comp := GREATEST(auto_total, home_total) + ROUND(0.4 * LEAST(auto_total, home_total))::int;

  SELECT coalesce(company_name, full_name, email) INTO vendor_name FROM public.profiles WHERE id = p_vendor_id;
  is_ivantage := vendor_name ILIKE '%ivantage%';
  is_allstate := lower(coalesce(auto_norm,'')) = 'allstate' OR lower(coalesce(home_norm,'')) = 'allstate';

  IF lt = 'winback' THEN
    is_winback := true;
  ELSIF p_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.phone = p_phone AND (l.dispo = 'sold' OR l.home_dispo = 'sold')
  ) THEN
    is_winback := true;
  END IF;

  IF lt = 'requote' AND NOT is_winback THEN
    is_requote := true;
  ELSIF NOT is_winback AND (auto_norm IS NOT NULL OR home_norm IS NOT NULL) THEN
    is_requote := true;
  END IF;

  is_aged := coalesce(p_is_aged_source, false) OR lt = 'aged';

  wb_base := coalesce((w->>'tier_winback_base')::int, 2);
  wb_per  := coalesce((w->>'tier_winback_per_vehicle')::int, 4);
  wb_max  := coalesce((w->>'tier_winback_bonus')::int, 18);
  nv := coalesce(p_num_vehicles, 0);
  wb_units := GREATEST(nv, CASE WHEN NULLIF(btrim(coalesce(auto_norm, '')), '') IS NOT NULL THEN 1 ELSE 0 END);

  IF is_ivantage AND NOT is_allstate THEN
    tier := 'S'; comp := comp + coalesce((w->>'tier_ivantage_bonus')::int, 40);
  ELSIF is_winback THEN
    tier := 'A';
    IF NOT has_auto OR wb_units <= 0 THEN wb_bonus := 0;
    ELSE wb_bonus := LEAST(wb_base + wb_per * wb_units, wb_max);
    END IF;
    comp := comp + wb_bonus;
  ELSIF is_aged THEN
    tier := 'C'; comp := comp + coalesce((w->>'tier_aged_penalty')::int, -10);
  ELSIF is_requote THEN
    tier := 'B'; comp := comp + coalesce((w->>'tier_requote_bonus')::int, 10);
  END IF;

  comp := GREATEST(0, comp);

  RETURN QUERY SELECT auto_total, home_total, comp, tier,
    jsonb_build_object(
      'recency', v_recency, 'contact', v_contact, 'source', v_source,
      'engagement', v_engagement, 'age', v_age, 'vehicles', v_vehicles,
      'auto_carrier', v_auto_carrier, 'home_carrier', v_home_carrier,
      'auto_carrier_norm', auto_norm, 'home_carrier_norm', home_norm,
      'auto_carrier_bucket', auto_bucket, 'home_carrier_bucket', home_bucket,
      'bundling', v_bundling, 'property', v_property,
      'hours_old', round(hours_old, 1),
      'list_type', p_list_type,
      'is_ivantage', is_ivantage, 'is_allstate_carrier', is_allstate,
      'is_winback', is_winback, 'is_requote', is_requote, 'is_aged', is_aged,
      'has_auto', has_auto, 'has_home', has_home,
      'explicit_auto', explicit_auto, 'explicit_home', explicit_home,
      'inferred_auto', inferred_auto, 'inferred_home', inferred_home,
      'winback_bonus', CASE WHEN is_winback THEN wb_bonus ELSE 0 END,
      'num_vehicles', nv,
      'winback_units', wb_units,
      'home', jsonb_build_object(
        'age', v_home_age, 'value', v_home_value, 'roof', v_home_roof,
        'construction', v_home_construction, 'flood', v_home_flood,
        'size', v_home_size, 'liability', v_home_liability,
        'carrier', v_home_carrier, 'recency', v_recency, 'source', v_source,
        'year_built', p_year_built, 'dwelling_value', p_dwelling_value,
        'roof_year', p_roof_year, 'construction_type', p_construction_type,
        'flood_zone', p_flood_zone, 'square_feet', p_square_feet,
        'has_pool', p_has_pool, 'has_trampoline', p_has_trampoline
      )
    );
END $function$;

-- Update triggers to pass new property columns
CREATE OR REPLACE FUNCTION public.leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; w jsonb;
  v_releases int; v_per int; v_cap int; v_window numeric;
  v_base int; v_decay numeric; v_penalty int; v_days numeric;
  nc_count int; nc_recover_per_day numeric; nc_days numeric; nc_multiplier numeric; pre_nc int;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    false,
    coalesce(NEW.lead_source, '') = 'aged',
    NULL,
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

CREATE OR REPLACE FUNCTION public.list_leads_score_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; w jsonb;
  nc_count int; nc_recover_per_day numeric; nc_days numeric; nc_multiplier numeric; pre_nc int;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id, NEW.phone, NEW.email, NEW.housing_status, NEW.num_vehicles,
    NEW.current_carrier, NEW.current_home_carrier, NEW.date_of_birth, NEW.created_at,
    NEW.dispo::text, NEW.home_dispo::text, NEW.lead_types,
    NEW.year_built, NEW.square_feet, NEW.dwelling_value,
    true,
    coalesce(NEW.list_type, '') = 'aged',
    NEW.list_type,
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
