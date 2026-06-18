
-- Lead type enum
DO $$ BEGIN
  CREATE TYPE public.lead_type AS ENUM ('auto', 'home', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add lead_type + home fields to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_type public.lead_type NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS current_home_carrier text,
  ADD COLUMN IF NOT EXISTS year_built integer,
  ADD COLUMN IF NOT EXISTS square_feet integer,
  ADD COLUMN IF NOT EXISTS construction_type text,
  ADD COLUMN IF NOT EXISTS roof_type text,
  ADD COLUMN IF NOT EXISTS roof_year integer,
  ADD COLUMN IF NOT EXISTS num_stories integer,
  ADD COLUMN IF NOT EXISTS num_bedrooms integer,
  ADD COLUMN IF NOT EXISTS num_bathrooms numeric(4,1),
  ADD COLUMN IF NOT EXISTS dwelling_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS has_pool boolean,
  ADD COLUMN IF NOT EXISTS has_trampoline boolean,
  ADD COLUMN IF NOT EXISTS claims_last_5y integer,
  ADD COLUMN IF NOT EXISTS mortgage_company text;

-- Auto fields become optional so home-only leads can be saved
ALTER TABLE public.leads ALTER COLUMN current_carrier DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN num_vehicles DROP NOT NULL;

-- Same for list_leads
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS lead_type public.lead_type NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS current_home_carrier text,
  ADD COLUMN IF NOT EXISTS year_built integer,
  ADD COLUMN IF NOT EXISTS square_feet integer,
  ADD COLUMN IF NOT EXISTS construction_type text,
  ADD COLUMN IF NOT EXISTS roof_type text,
  ADD COLUMN IF NOT EXISTS roof_year integer,
  ADD COLUMN IF NOT EXISTS num_stories integer,
  ADD COLUMN IF NOT EXISTS num_bedrooms integer,
  ADD COLUMN IF NOT EXISTS num_bathrooms numeric(4,1),
  ADD COLUMN IF NOT EXISTS dwelling_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS has_pool boolean,
  ADD COLUMN IF NOT EXISTS has_trampoline boolean,
  ADD COLUMN IF NOT EXISTS claims_last_5y integer,
  ADD COLUMN IF NOT EXISTS mortgage_company text;

ALTER TABLE public.list_leads ALTER COLUMN current_carrier DROP NOT NULL;
ALTER TABLE public.list_leads ALTER COLUMN num_vehicles DROP NOT NULL;
