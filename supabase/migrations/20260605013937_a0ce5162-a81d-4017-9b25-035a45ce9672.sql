
-- 1) Add archived_at + not_billable columns
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS not_billable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_list_leads_archived_at ON public.list_leads(archived_at);
CREATE INDEX IF NOT EXISTS idx_list_leads_not_billable ON public.list_leads(not_billable) WHERE not_billable;

-- 2) Carrier normalization
CREATE OR REPLACE FUNCTION public.normalize_carrier(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  c text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  c := lower(regexp_replace(trim(raw), '\s+', ' ', 'g'));
  c := regexp_replace(c, '\s+(insurance|ins\.?|inc\.?|co\.?|company|direct|group|corp\.?|llc)$', '', 'g');
  c := trim(c);
  RETURN CASE
    WHEN c IN ('','none','no insurance','no current insurance','no ins','none currently','uninsured') THEN NULL
    WHEN c ~ 'all\s*state|allstte|alstate' THEN 'Allstate'
    WHEN c ~ 'state\s*farm|st\.?\s*farm|sf' THEN 'State Farm'
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
    WHEN c ~ 'kemper' THEN 'Kemper'
    WHEN c ~ 'national\s*general|natgen' THEN 'National General'
    WHEN c ~ 'direct\s*auto' THEN 'Direct Auto'
    WHEN c ~ 'dairyland' THEN 'Dairyland'
    WHEN c ~ 'bristol\s*west' THEN 'Bristol West'
    WHEN c ~ 'lemonade' THEN 'Lemonade'
    WHEN c ~ 'plymouth\s*rock' THEN 'Plymouth Rock'
    WHEN c ~ 'commerce' THEN 'Commerce'
    ELSE initcap(c)
  END;
END;
$$;

-- 3) Validate DOB helper — returns NULL when DOB is implausible
CREATE OR REPLACE FUNCTION public.clean_dob(d date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN d IS NULL THEN NULL
    WHEN d > current_date THEN NULL
    WHEN d < current_date - interval '110 years' THEN NULL
    WHEN d > current_date - interval '16 years' THEN NULL
    ELSE d
  END;
$$;

-- 4) Trigger to normalize on insert/update of list_leads
CREATE OR REPLACE FUNCTION public.list_leads_normalize_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.current_carrier := public.normalize_carrier(NEW.current_carrier);
  NEW.date_of_birth   := public.clean_dob(NEW.date_of_birth);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS list_leads_normalize ON public.list_leads;
CREATE TRIGGER list_leads_normalize
BEFORE INSERT OR UPDATE OF current_carrier, date_of_birth
ON public.list_leads
FOR EACH ROW EXECUTE FUNCTION public.list_leads_normalize_trg();

-- Same for leads table
DROP TRIGGER IF EXISTS leads_normalize ON public.leads;
CREATE TRIGGER leads_normalize
BEFORE INSERT OR UPDATE OF current_carrier, date_of_birth
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.list_leads_normalize_trg();

-- 5) One-time backfill of existing data
UPDATE public.list_leads
SET current_carrier = public.normalize_carrier(current_carrier),
    date_of_birth   = public.clean_dob(date_of_birth)
WHERE current_carrier IS NOT NULL OR date_of_birth IS NOT NULL;

UPDATE public.leads
SET current_carrier = public.normalize_carrier(current_carrier),
    date_of_birth   = public.clean_dob(date_of_birth)
WHERE current_carrier IS NOT NULL OR date_of_birth IS NOT NULL;
