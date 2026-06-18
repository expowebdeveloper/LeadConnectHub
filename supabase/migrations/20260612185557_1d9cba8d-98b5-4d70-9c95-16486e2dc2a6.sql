
CREATE TABLE public.zillow_property_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  address_key text,
  zestimate numeric,
  rent_zestimate numeric,
  beds int,
  baths numeric,
  sqft int,
  lot_sqft int,
  year_built int,
  roof_year int,
  construction_type text,
  last_sold_price numeric,
  last_sold_date date,
  annual_tax numeric,
  tax_assessed_value numeric,
  flood_zone text,
  has_pool boolean,
  photo_url text,
  listing_url text,
  raw jsonb,
  fetch_error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zillow_property_data_address_key_idx ON public.zillow_property_data(address_key);

GRANT SELECT ON public.zillow_property_data TO authenticated;
GRANT ALL ON public.zillow_property_data TO service_role;

ALTER TABLE public.zillow_property_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Zillow cache visible when lead is visible"
  ON public.zillow_property_data
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

CREATE OR REPLACE FUNCTION public.zillow_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER zillow_property_data_set_updated_at
  BEFORE UPDATE ON public.zillow_property_data
  FOR EACH ROW EXECUTE FUNCTION public.zillow_set_updated_at();
