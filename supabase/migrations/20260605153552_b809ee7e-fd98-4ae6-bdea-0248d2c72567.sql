
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_types text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS lead_types text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.leads
SET lead_types = CASE
  WHEN lead_type::text = 'both' THEN ARRAY['auto','home']
  WHEN lead_type IS NOT NULL THEN ARRAY[lead_type::text]
  ELSE '{}'::text[]
END
WHERE lead_types = '{}'::text[];

UPDATE public.list_leads
SET lead_types = CASE
  WHEN lead_type::text = 'both' THEN ARRAY['auto','home']
  WHEN lead_type IS NOT NULL THEN ARRAY[lead_type::text]
  ELSE '{}'::text[]
END
WHERE lead_types = '{}'::text[];

CREATE INDEX IF NOT EXISTS leads_lead_types_gin ON public.leads USING gin (lead_types);
CREATE INDEX IF NOT EXISTS list_leads_lead_types_gin ON public.list_leads USING gin (lead_types);
