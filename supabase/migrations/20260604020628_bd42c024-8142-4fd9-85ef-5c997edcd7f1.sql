ALTER TYPE public.lead_dispo ADD VALUE IF NOT EXISTS 'x_date';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS x_date date;
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS x_date date;