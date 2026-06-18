ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS billable_override boolean;
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS billable_override boolean;