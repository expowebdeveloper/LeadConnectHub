
-- ============================================================
-- 1. Score columns on leads + list_leads
-- ============================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS auto_score      integer,
  ADD COLUMN IF NOT EXISTS home_score      integer,
  ADD COLUMN IF NOT EXISTS composite_score integer,
  ADD COLUMN IF NOT EXISTS score_tier      text,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS scored_at       timestamptz;

ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS auto_score      integer,
  ADD COLUMN IF NOT EXISTS home_score      integer,
  ADD COLUMN IF NOT EXISTS composite_score integer,
  ADD COLUMN IF NOT EXISTS score_tier      text,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS scored_at       timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_composite_score      ON public.leads (composite_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_list_leads_composite_score ON public.list_leads (composite_score DESC NULLS LAST);

-- ============================================================
-- 2. Scoring weights config table (single-row, admin-tunable)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scoring_weights (
  id           int PRIMARY KEY DEFAULT 1,
  weights      jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT scoring_weights_singleton CHECK (id = 1)
);

GRANT SELECT ON public.scoring_weights TO authenticated;
GRANT ALL    ON public.scoring_weights TO service_role;

ALTER TABLE public.scoring_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authed can read scoring weights" ON public.scoring_weights;
CREATE POLICY "Anyone authed can read scoring weights"
  ON public.scoring_weights FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage scoring weights" ON public.scoring_weights;
CREATE POLICY "Admins manage scoring weights"
  ON public.scoring_weights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.scoring_weights (id, weights)
VALUES (1, jsonb_build_object(
  'vehicle_per_unit', 5, 'vehicle_cap', 25,
  'carrier_max', 15, 'age_max', 10,
  'recency_max', 25,
  'contact_max', 10, 'source_max', 10, 'engagement_max', 5,
  'bundling_max', 15, 'property_max', 15,
  'tier_ivantage_bonus', 40,
  'tier_winback_bonus',  25,
  'tier_requote_bonus',  15,
  'tier_aged_penalty',  -10,
  'aged_days', 14
))
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. calc_lead_score function
-- ============================================================
CREATE OR REPLACE FUNCTION public.calc_lead_score(
  p_vendor_id          uuid,
  p_phone              text,
  p_email              text,
  p_housing_status     text,
  p_num_vehicles       int,
  p_auto_carrier       text,
  p_home_carrier       text,
  p_date_of_birth      date,
  p_created_at         timestamptz,
  p_dispo              text,
  p_home_dispo         text,
  p_lead_types         text[],
  p_year_built         int,
  p_square_feet        int,
  p_dwelling_value     numeric,
  p_is_list_source     boolean
) RETURNS TABLE (
  auto_score      int,
  home_score      int,
  composite_score int,
  score_tier      text,
  breakdown       jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w jsonb;
  age_years      int;
  hours_old      numeric;
  v_recency      int;
  v_contact      int;
  v_source       int;
  v_engagement   int;
  v_age          int;
  v_auto_carrier int;
  v_home_carrier int;
  v_vehicles     int;
  v_bundling     int;
  v_property     int;
  auto_total     int := 0;
  home_total     int := 0;
  comp           int;
  tier           text := NULL;
  vendor_name    text;
  is_ivantage    boolean := false;
  is_allstate    boolean := false;
  is_winback     boolean := false;
  is_requote     boolean := false;
  is_aged        boolean := false;
  carrier_lc     text;
  has_auto       boolean;
  has_home       boolean;
BEGIN
  SELECT weights INTO w FROM public.scoring_weights WHERE id = 1;
  IF w IS NULL THEN
    w := '{}'::jsonb;
  END IF;

  has_auto := p_lead_types IS NOT NULL AND 'auto' = ANY(p_lead_types);
  has_home := p_lead_types IS NOT NULL AND ('home' = ANY(p_lead_types) OR 'renters' = ANY(p_lead_types));

  -- Recency (broader tiers)
  hours_old := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(p_created_at, now()))) / 3600.0);
  v_recency := CASE
    WHEN hours_old <= 0.5  THEN 25
    WHEN hours_old <= 2    THEN 22
    WHEN hours_old <= 6    THEN 19
    WHEN hours_old <= 24   THEN 15
    WHEN hours_old <= 72   THEN 11
    WHEN hours_old <= 168  THEN 7
    WHEN hours_old <= 336  THEN 4
    WHEN hours_old <= 720  THEN 2
    ELSE 0
  END;

  -- Contactability
  v_contact := 0;
  IF p_phone IS NOT NULL AND length(trim(p_phone)) >= 10 THEN v_contact := v_contact + 5; END IF;
  IF p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$'   THEN v_contact := v_contact + 5; END IF;

  -- Source quality (live submission outranks imported list)
  v_source := CASE WHEN p_is_list_source THEN 4 ELSE 10 END;

  -- Engagement (any prior dispo activity counts)
  v_engagement := 0;
  IF p_dispo IS NOT NULL AND p_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 3; END IF;
  IF p_home_dispo IS NOT NULL AND p_home_dispo NOT IN ('new','') THEN v_engagement := v_engagement + 2; END IF;
  IF v_engagement > 5 THEN v_engagement := 5; END IF;

  -- Age band (driver/applicant age)
  IF p_date_of_birth IS NULL THEN
    v_age := 4;
  ELSE
    age_years := EXTRACT(YEAR FROM age(p_date_of_birth))::int;
    v_age := CASE
      WHEN age_years BETWEEN 30 AND 65 THEN 10
      WHEN age_years BETWEEN 25 AND 75 THEN 7
      WHEN age_years BETWEEN 21 AND 80 THEN 4
      ELSE 1
    END;
  END IF;

  -- Carrier quality scoring (off-brand / no insurance = high quality lead to win)
  carrier_lc := lower(coalesce(p_auto_carrier, ''));
  v_auto_carrier := CASE
    WHEN carrier_lc = '' OR carrier_lc IN ('none','no insurance','uninsured') THEN 15
    WHEN carrier_lc ~ 'geico|progressive|state\s*farm|allstate|usaa' THEN 5
    WHEN carrier_lc ~ 'liberty|farmers|travelers|nationwide|american\s*family' THEN 8
    ELSE 12
  END;

  carrier_lc := lower(coalesce(p_home_carrier, ''));
  v_home_carrier := CASE
    WHEN carrier_lc = '' OR carrier_lc IN ('none','no insurance','uninsured') THEN 15
    WHEN carrier_lc ~ 'geico|progressive|state\s*farm|allstate|usaa' THEN 5
    WHEN carrier_lc ~ 'liberty|farmers|travelers|nationwide|american\s*family' THEN 8
    ELSE 12
  END;

  -- Vehicle count: 5 pts each, cap 25
  v_vehicles := LEAST(coalesce(p_num_vehicles, 0) * 5, 25);

  -- Bundling (only counts for home side when auto is also present)
  v_bundling := CASE WHEN has_auto AND has_home THEN 15 ELSE 0 END;

  -- Property completeness (home side)
  v_property := 0;
  IF p_year_built IS NOT NULL     THEN v_property := v_property + 5; END IF;
  IF p_square_feet IS NOT NULL    THEN v_property := v_property + 5; END IF;
  IF p_dwelling_value IS NOT NULL THEN v_property := v_property + 5; END IF;

  -- ===== Auto side total =====
  IF has_auto THEN
    auto_total := v_vehicles + v_auto_carrier + v_age + v_recency + v_contact + v_source + v_engagement;
  ELSE
    auto_total := 0;
  END IF;

  -- ===== Home side total =====
  IF has_home AND coalesce(p_housing_status,'') <> 'renter' THEN
    home_total := v_home_carrier + v_age + v_recency + v_contact + v_source + v_bundling + v_property;
  ELSE
    home_total := 0;
  END IF;

  auto_total := GREATEST(0, LEAST(auto_total, 100));
  home_total := GREATEST(0, LEAST(home_total, 100));

  -- Composite
  comp := GREATEST(auto_total, home_total) + ROUND(0.4 * LEAST(auto_total, home_total))::int;

  -- ===== Tier detection =====
  SELECT coalesce(company_name, full_name, email) INTO vendor_name
  FROM public.profiles WHERE id = p_vendor_id;
  is_ivantage := vendor_name ILIKE '%ivantage%';
  is_allstate := lower(coalesce(p_auto_carrier,'')) ~ 'all\s*state' OR lower(coalesce(p_home_carrier,'')) ~ 'all\s*state';

  -- Win-back: explicit dispo OR phone match against prior sold/cancelled lead
  IF p_dispo = 'previously_sold' OR p_home_dispo = 'previously_sold' THEN
    is_winback := true;
  ELSIF p_phone IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.phone = p_phone
        AND (l.dispo IN ('sold','cancelled') OR l.home_dispo IN ('sold','cancelled'))
    ) THEN
      is_winback := true;
    END IF;
  END IF;

  -- Requote: current carrier shopping (any auto/home carrier set, not a major target)
  IF NOT is_winback AND (p_auto_carrier IS NOT NULL OR p_home_carrier IS NOT NULL) THEN
    is_requote := true;
  END IF;

  -- Aged: >14 days old with no engagement
  IF hours_old > 24 * coalesce((w->>'aged_days')::int, 14)
     AND coalesce(p_dispo, 'new') IN ('new','') AND coalesce(p_home_dispo, 'new') IN ('new','') THEN
    is_aged := true;
  END IF;

  IF is_ivantage AND NOT is_allstate THEN
    tier := 'S';
    comp := comp + coalesce((w->>'tier_ivantage_bonus')::int, 40);
  ELSIF is_winback THEN
    tier := 'A';
    comp := comp + coalesce((w->>'tier_winback_bonus')::int, 25);
  ELSIF is_requote THEN
    tier := 'B';
    comp := comp + coalesce((w->>'tier_requote_bonus')::int, 15);
  ELSIF is_aged THEN
    tier := 'C';
    comp := comp + coalesce((w->>'tier_aged_penalty')::int, -10);
  END IF;

  comp := GREATEST(0, LEAST(comp, 100));

  RETURN QUERY SELECT
    auto_total,
    home_total,
    comp,
    tier,
    jsonb_build_object(
      'recency', v_recency,
      'contact', v_contact,
      'source', v_source,
      'engagement', v_engagement,
      'age', v_age,
      'vehicles', v_vehicles,
      'auto_carrier', v_auto_carrier,
      'home_carrier', v_home_carrier,
      'bundling', v_bundling,
      'property', v_property,
      'hours_old', round(hours_old, 1),
      'is_ivantage', is_ivantage,
      'is_allstate_carrier', is_allstate,
      'is_winback', is_winback,
      'is_requote', is_requote,
      'is_aged', is_aged
    );
END $$;

-- ============================================================
-- 4. Triggers to maintain scores on leads + list_leads
-- ============================================================
CREATE OR REPLACE FUNCTION public.leads_score_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id,
    NEW.phone,
    NEW.email,
    NEW.housing_status,
    NEW.num_vehicles,
    NEW.current_carrier,
    NEW.current_home_carrier,
    NEW.date_of_birth,
    NEW.created_at,
    NEW.dispo::text,
    NEW.home_dispo::text,
    NEW.lead_types,
    NEW.year_built,
    NEW.square_feet,
    NEW.dwelling_value,
    false
  );
  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := r.composite_score;
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown;
  NEW.scored_at       := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.list_leads_score_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.calc_lead_score(
    NEW.vendor_id,
    NEW.phone,
    NEW.email,
    NEW.housing_status,
    NEW.num_vehicles,
    NEW.current_carrier,
    NEW.current_home_carrier,
    NEW.date_of_birth,
    NEW.created_at,
    NEW.dispo::text,
    NEW.home_dispo::text,
    NEW.lead_types,
    NEW.year_built,
    NEW.square_feet,
    NEW.dwelling_value,
    true
  );
  NEW.auto_score      := r.auto_score;
  NEW.home_score      := r.home_score;
  NEW.composite_score := r.composite_score;
  NEW.score_tier      := r.score_tier;
  NEW.score_breakdown := r.breakdown;
  NEW.scored_at       := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_score_biu ON public.leads;
CREATE TRIGGER leads_score_biu
BEFORE INSERT OR UPDATE OF vendor_id, phone, email, housing_status, num_vehicles,
  current_carrier, current_home_carrier, date_of_birth, dispo, home_dispo,
  lead_types, year_built, square_feet, dwelling_value
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_score_trg();

DROP TRIGGER IF EXISTS list_leads_score_biu ON public.list_leads;
CREATE TRIGGER list_leads_score_biu
BEFORE INSERT OR UPDATE OF vendor_id, phone, email, housing_status, num_vehicles,
  current_carrier, current_home_carrier, date_of_birth, dispo, home_dispo,
  lead_types, year_built, square_feet, dwelling_value
ON public.list_leads
FOR EACH ROW EXECUTE FUNCTION public.list_leads_score_trg();

-- ============================================================
-- 5. Backfill existing rows
-- ============================================================
UPDATE public.leads      SET updated_at = updated_at;  -- no-op write fires trigger
UPDATE public.list_leads SET updated_at = updated_at;
