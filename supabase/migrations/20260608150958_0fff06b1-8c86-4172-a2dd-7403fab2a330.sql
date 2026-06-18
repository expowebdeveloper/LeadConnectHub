-- Add the new "Already Has Allstate" dispo enum value.
ALTER TYPE public.lead_dispo ADD VALUE IF NOT EXISTS 'already_has_allstate';

-- Admin-managed dispo options. Lets admins add, rename, reorder or
-- hide call-outcome dispositions without code changes. The enum
-- still backs the column; this table controls what the UI shows.
CREATE TABLE IF NOT EXISTS public.dispo_options (
  value text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispo_options TO authenticated;
GRANT ALL ON public.dispo_options TO service_role;

ALTER TABLE public.dispo_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed-in can read dispo options"
  ON public.dispo_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage dispo options"
  ON public.dispo_options FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER dispo_options_touch
  BEFORE UPDATE ON public.dispo_options
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the existing dispos (and the new Allstate one). System rows
-- are still toggleable/renameable but flagged so the UI can warn
-- when an admin disables a built-in outcome.
INSERT INTO public.dispo_options (value, label, sort_order, enabled, is_system) VALUES
  ('quoted',                'Quoted',                10, true, true),
  ('sold',                  'Sold',                  20, true, true),
  ('not_quoted',            'Not Quoted',            30, true, true),
  ('follow_up',             'Follow Up',             40, true, true),
  ('x_date',                'X-Date',                50, true, true),
  ('already_has_allstate',  'Already Has Allstate',  55, true, true),
  ('wrong_number',          'Wrong Number',          60, true, true),
  ('dead',                  'Dead',                  70, true, true),
  ('dnc',                   'DNC',                   80, true, true)
ON CONFLICT (value) DO NOTHING;

-- Admin-only helper to add a brand-new dispo. It extends the enum
-- (cannot be done from supabase-js) and inserts the matching row.
CREATE OR REPLACE FUNCTION public.add_dispo_option(p_value text, p_label text, p_sort int DEFAULT 100)
RETURNS public.dispo_options
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_row public.dispo_options;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden — admin only';
  END IF;

  v_clean := lower(regexp_replace(coalesce(p_value, ''), '[^a-z0-9_]+', '_', 'gi'));
  v_clean := regexp_replace(v_clean, '^_+|_+$', '', 'g');
  IF v_clean = '' THEN RAISE EXCEPTION 'Value cannot be empty'; END IF;
  IF coalesce(trim(p_label), '') = '' THEN RAISE EXCEPTION 'Label cannot be empty'; END IF;

  EXECUTE format('ALTER TYPE public.lead_dispo ADD VALUE IF NOT EXISTS %L', v_clean);

  INSERT INTO public.dispo_options(value, label, sort_order, enabled, is_system)
  VALUES (v_clean, trim(p_label), coalesce(p_sort, 100), true, false)
  ON CONFLICT (value) DO UPDATE
    SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, enabled = true
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.add_dispo_option(text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.add_dispo_option(text, text, int) TO authenticated;
