
ALTER TYPE lead_dispo ADD VALUE IF NOT EXISTS 'already_a_client';

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS existing_client_lines text[];
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS existing_client_lines text[];

INSERT INTO public.dispo_options (value, label, sort_order, enabled, is_system)
VALUES ('already_a_client', 'Already a Client', 56, true, true)
ON CONFLICT (value) DO NOTHING;
