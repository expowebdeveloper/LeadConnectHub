
ALTER TABLE public.zillow_property_data DROP CONSTRAINT IF EXISTS zillow_property_data_lead_id_fkey;
ALTER TABLE public.zillow_property_data ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'leads';
UPDATE public.zillow_property_data SET source = 'leads' WHERE source IS NULL;
ALTER TABLE public.zillow_property_data DROP CONSTRAINT IF EXISTS zillow_property_data_lead_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS zillow_property_data_source_lead_id_key
  ON public.zillow_property_data (source, lead_id);
