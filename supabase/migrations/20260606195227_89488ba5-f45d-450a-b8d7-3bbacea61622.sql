
-- Add UAIC and Infinity to the carrier normalizer
CREATE OR REPLACE FUNCTION public.normalize_carrier(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE c text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  c := lower(regexp_replace(trim(raw), '\s+', ' ', 'g'));
  c := regexp_replace(c, '\s+(insurance|ins\.?|inc\.?|co\.?|company|direct|group|corp\.?|llc)$', '', 'g');
  c := trim(c);
  RETURN CASE
    WHEN c IN ('','none','no insurance','no current insurance','no ins','none currently','uninsured') THEN NULL
    WHEN c ~ '\maaa\M|^aaa$|triple\s*a|auto\s*club' THEN 'AAA'
    WHEN c ~ 'all\s*state|allstte|alstate' THEN 'Allstate'
    WHEN c ~ 'state\s*farm|st\.?\s*farm|^sf$' THEN 'State Farm'
    WHEN c ~ 'geico|gieco' THEN 'Geico'
    WHEN c ~ 'progressive|prog' THEN 'Progressive'
    WHEN c ~ 'usaa' THEN 'USAA'
    WHEN c ~ 'liberty' THEN 'Liberty Mutual'
    WHEN c ~ 'farmers' THEN 'Farmers'
    WHEN c ~ 'travelers|travellers' THEN 'Travelers'
    WHEN c ~ 'nationwide' THEN 'Nationwide'
    WHEN c ~ 'esurance' THEN 'Esurance'
    WHEN c ~ 'american\s*family|am\s*fam|amfam' THEN 'American Family'
    WHEN c ~ 'mercury' THEN 'Mercury'
    WHEN c ~ 'safeco' THEN 'Safeco'
    WHEN c ~ 'the\s*general|general\s*ins' THEN 'The General'
    WHEN c ~ 'root' THEN 'Root'
    WHEN c ~ 'metlife|met\s*life' THEN 'MetLife'
    WHEN c ~ 'hartford' THEN 'The Hartford'
    WHEN c ~ 'erie' THEN 'Erie'
    WHEN c ~ 'auto[-\s]?owners' THEN 'Auto-Owners'
    WHEN c ~ 'kemper|infinity' THEN 'Kemper'
    WHEN c ~ 'national\s*general|natgen' THEN 'National General'
    WHEN c ~ 'direct\s*auto' THEN 'Direct Auto'
    WHEN c ~ 'dairyland' THEN 'Dairyland'
    WHEN c ~ 'bristol\s*west' THEN 'Bristol West'
    WHEN c ~ 'lemonade' THEN 'Lemonade'
    WHEN c ~ 'plymouth\s*rock' THEN 'Plymouth Rock'
    WHEN c ~ 'commerce' THEN 'Commerce'
    WHEN c ~ 'uaic|united\s*auto' THEN 'UAIC'
    ELSE initcap(c)
  END;
END;
$function$;

-- Replace scoring function to add non-standard bucket
CREATE OR REPLACE FUNCTION public.calc_lead_score(p_vendor_id uuid, p_phone text, p_email text, p_housing_status text, p_num_vehicles integer, p_auto_carrier text, p_home_carrier text, p_date_of_birth date, p_created_at timestamp with time zone, p_dispo text, p_home_dispo text, p_lead_types text[], p_year_built integer, p_square_feet integer, p_dwelling_value numeric, p_is_list_source boolean)
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
  auto_total int := 0; home_total int := 0; comp int; tier text := NULL;
  vendor_name text;
  is_ivantage boolean := false; is_allstate boolean := false;
  is_winback boolean := false; is_requote boolean := false; is_aged boolean := false;
  has_auto boolean; has_home boolean;
  pts_cheap int; pts_std int; pts_prem int; pts_unk int; pts_none int; pts_nonstd int;
  cheap_l text[]; std_l text[]; prem_l text[]; nonstd_l text[];
  auto_norm text; home_norm text; auto_bucket text; home_bucket text;
BEGIN
  SELECT weights INTO w FROM public.scoring_weights WHERE id = 1;
  IF w IS NULL THEN w := '{}'::jsonb; END IF;

  pts_cheap  := coalesce((w->>'carrier_pts_cheap')::int, 5);
  pts_std    := coalesce((w->>'carrier_pts_standard')::int, 10);
  pts_prem   := coalesce((w->>'carrier_pts_premium')::int, 15);
  pts_unk    := coalesce((w->>'carrier_pts_unknown')::int, 8);
  pts_none   := coalesce((w->>'carrier_pts_none')::int, 15);
  pts_nonstd := coalesce((w->>'carrier_pts_nonstandard')::int, 2);

  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO cheap_l  FROM jsonb_array_elements_text(coalesce(w->'carriers_cheap','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO std_l    FROM jsonb_array_elements_text(coalesce(w->'carriers_standard','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO prem_l   FROM jsonb_array_elements_text(coalesce(w->'carriers_premium','[]'::jsonb)) x;
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) INTO nonstd_l FROM jsonb_array_elements_text(coalesce(w->'carriers_nonstandard','[]'::jsonb)) x;

  has_auto := p_lead_types IS NOT NULL AND 'auto' = ANY(p_lead_types);
  has_home := p_lead_types IS NOT NULL AND ('home' = ANY(p_lead_types) OR 'renters' = ANY(p_lead_types));

  hours_old := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p_created_at, now()))) / 3600.0);
  v_recency := CASE
    WHEN hours_old <= 0.5 THEN 25 WHEN hours_old <= 2 THEN 22
    WHEN hours_old <= 6 THEN 19 WHEN hours_old <= 24 THEN 15
    WHEN hours_old <= 72 THEN 11 WHEN hours_old <= 168 THEN 7
    WHEN hours_old <= 336 THEN 4 WHEN hours_old <= 720 THEN 2 ELSE 0
  END;

  v_contact := 0;
  IF p_phone IS NOT NULL AND length(trim(p_phone)) >= 10 THEN v_contact := v_contact + 5; END IF;
  IF p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$' THEN v_contact := v_contact + 5; END IF;

  v_source := CASE WHEN p_is_list_source THEN 4 ELSE 10 END;

  v_engagement := 0;
  IF p_dispo IS NOT NULL AND p_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 3; END IF;
  IF p_home_dispo IS NOT NULL AND p_home_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 2; END IF;
  IF v_engagement > 5 THEN v_engagement := 5; END IF;

  IF p_date_of_birth IS NULL THEN v_age := 4;
  ELSE
    age_years := EXTRACT(YEAR FROM age(p_date_of_birth))::int;
    v_age := CASE
      WHEN age_years BETWEEN 30 AND 65 THEN 10
      WHEN age_years BETWEEN 25 AND 75 THEN 7
      WHEN age_years BETWEEN 21 AND 80 THEN 4 ELSE 1
    END;
  END IF;

  auto_norm := public.normalize_carrier(p_auto_carrier);
  IF auto_norm IS NULL THEN
    v_auto_carrier := pts_none; auto_bucket := 'none';
  ELSIF lower(auto_norm) = ANY(nonstd_l) THEN
    v_auto_carrier := pts_nonstd; auto_bucket := 'nonstandard';
  ELSIF lower(auto_norm) = ANY(prem_l) THEN
    v_auto_carrier := pts_prem; auto_bucket := 'premium';
  ELSIF lower(auto_norm) = ANY(std_l) THEN
    v_auto_carrier := pts_std; auto_bucket := 'standard';
  ELSIF lower(auto_norm) = ANY(cheap_l) THEN
    v_auto_carrier := pts_cheap; auto_bucket := 'cheap';
  ELSE
    v_auto_carrier := pts_unk; auto_bucket := 'unknown';
  END IF;

  home_norm := public.normalize_carrier(p_home_carrier);
  IF home_norm IS NULL THEN
    v_home_carrier := pts_none; home_bucket := 'none';
  ELSIF lower(home_norm) = ANY(nonstd_l) THEN
    v_home_carrier := pts_nonstd; home_bucket := 'nonstandard';
  ELSIF lower(home_norm) = ANY(prem_l) THEN
    v_home_carrier := pts_prem; home_bucket := 'premium';
  ELSIF lower(home_norm) = ANY(std_l) THEN
    v_home_carrier := pts_std; home_bucket := 'standard';
  ELSIF lower(home_norm) = ANY(cheap_l) THEN
    v_home_carrier := pts_cheap; home_bucket := 'cheap';
  ELSE
    v_home_carrier := pts_unk; home_bucket := 'unknown';
  END IF;

  v_vehicles := LEAST(coalesce(p_num_vehicles, 0) * coalesce((w->>'vehicle_per_unit')::int,5), coalesce((w->>'vehicle_cap')::int,25));
  v_bundling := CASE WHEN has_auto AND has_home THEN coalesce((w->>'bundling_max')::int,15) ELSE 0 END;
  v_property := 0;
  IF p_year_built IS NOT NULL THEN v_property := v_property + 5; END IF;
  IF p_square_feet IS NOT NULL THEN v_property := v_property + 5; END IF;
  IF p_dwelling_value IS NOT NULL THEN v_property := v_property + 5; END IF;

  IF has_auto THEN auto_total := v_vehicles + v_auto_carrier + v_age + v_recency + v_contact + v_source + v_engagement; END IF;
  IF has_home AND coalesce(p_housing_status,'') <> 'renter' THEN
    home_total := v_home_carrier + v_age + v_recency + v_contact + v_source + v_bundling + v_property;
  END IF;

  auto_total := GREATEST(0, LEAST(auto_total, 100));
  home_total := GREATEST(0, LEAST(home_total, 100));
  comp := GREATEST(auto_total, home_total) + ROUND(0.4 * LEAST(auto_total, home_total))::int;

  SELECT coalesce(company_name, full_name, email) INTO vendor_name FROM public.profiles WHERE id = p_vendor_id;
  is_ivantage := vendor_name ILIKE '%ivantage%';
  is_allstate := lower(coalesce(auto_norm,'')) = 'allstate' OR lower(coalesce(home_norm,'')) = 'allstate';

  IF p_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.leads l WHERE l.phone = p_phone AND (l.dispo = 'sold' OR l.home_dispo = 'sold')) THEN
      is_winback := true;
    END IF;
  END IF;

  IF NOT is_winback AND (auto_norm IS NOT NULL OR home_norm IS NOT NULL) THEN
    is_requote := true;
  END IF;

  IF hours_old > 24 * coalesce((w->>'aged_days')::int, 14)
     AND coalesce(p_dispo, 'new') IN ('new','') AND coalesce(p_home_dispo, 'new') IN ('new','') THEN
    is_aged := true;
  END IF;

  IF is_ivantage AND NOT is_allstate THEN
    tier := 'S'; comp := comp + coalesce((w->>'tier_ivantage_bonus')::int, 40);
  ELSIF is_winback THEN
    tier := 'A'; comp := comp + coalesce((w->>'tier_winback_bonus')::int, 25);
  ELSIF is_requote THEN
    tier := 'B'; comp := comp + coalesce((w->>'tier_requote_bonus')::int, 15);
  ELSIF is_aged THEN
    tier := 'C'; comp := comp + coalesce((w->>'tier_aged_penalty')::int, -10);
  END IF;

  comp := GREATEST(0, LEAST(comp, 100));

  RETURN QUERY SELECT auto_total, home_total, comp, tier,
    jsonb_build_object(
      'recency', v_recency, 'contact', v_contact, 'source', v_source,
      'engagement', v_engagement, 'age', v_age, 'vehicles', v_vehicles,
      'auto_carrier', v_auto_carrier, 'home_carrier', v_home_carrier,
      'auto_carrier_norm', auto_norm, 'home_carrier_norm', home_norm,
      'auto_carrier_bucket', auto_bucket, 'home_carrier_bucket', home_bucket,
      'bundling', v_bundling, 'property', v_property,
      'hours_old', round(hours_old, 1),
      'is_ivantage', is_ivantage, 'is_allstate_carrier', is_allstate,
      'is_winback', is_winback, 'is_requote', is_requote, 'is_aged', is_aged
    );
END $function$;

-- Update the saved scoring weights with new lists + non-standard bucket
UPDATE public.scoring_weights
SET weights = weights
  || jsonb_build_object(
    'carrier_pts_nonstandard', 2,
    'carrier_pts_cheap', 5,
    'carrier_pts_standard', 10,
    'carrier_pts_premium', 15,
    'carrier_pts_unknown', 8,
    'carrier_pts_none', 15,
    'carriers_nonstandard', jsonb_build_array(
      'The General','Dairyland','Bristol West','National General',
      'Direct Auto','Kemper','UAIC'
    ),
    'carriers_premium', jsonb_build_array(
      'Allstate','Liberty Mutual','Farmers','USAA','AAA'
    ),
    'carriers_standard', jsonb_build_array(
      'Nationwide','Progressive','Travelers','Mercury'
    ),
    'carriers_cheap', jsonb_build_array(
      'Geico','State Farm','Auto-Owners'
    )
  ),
  updated_at = now()
WHERE id = 1;

INSERT INTO public.scoring_weights (id, weights, updated_at)
SELECT 1, jsonb_build_object(
    'carrier_pts_nonstandard', 2,
    'carrier_pts_cheap', 5,
    'carrier_pts_standard', 10,
    'carrier_pts_premium', 15,
    'carrier_pts_unknown', 8,
    'carrier_pts_none', 15,
    'carriers_nonstandard', jsonb_build_array('The General','Dairyland','Bristol West','National General','Direct Auto','Kemper','UAIC'),
    'carriers_premium',     jsonb_build_array('Allstate','Liberty Mutual','Farmers','USAA','AAA'),
    'carriers_standard',    jsonb_build_array('Nationwide','Progressive','Travelers','Mercury'),
    'carriers_cheap',       jsonb_build_array('Geico','State Farm','Auto-Owners')
  ), now()
WHERE NOT EXISTS (SELECT 1 FROM public.scoring_weights WHERE id = 1);

-- Backfill: re-normalize existing carrier strings, then re-trigger scoring
UPDATE public.leads SET current_carrier = public.normalize_carrier(current_carrier)
  WHERE current_carrier IS NOT NULL;
UPDATE public.leads SET current_home_carrier = public.normalize_carrier(current_home_carrier)
  WHERE current_home_carrier IS NOT NULL;
UPDATE public.list_leads SET current_carrier = public.normalize_carrier(current_carrier)
  WHERE current_carrier IS NOT NULL;
UPDATE public.list_leads SET current_home_carrier = public.normalize_carrier(current_home_carrier)
  WHERE current_home_carrier IS NOT NULL;

UPDATE public.leads SET updated_at = now();
UPDATE public.list_leads SET updated_at = now();
