ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS litigator boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS litigator boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS list_leads_litigator_idx ON public.list_leads(litigator) WHERE litigator;
CREATE INDEX IF NOT EXISTS leads_litigator_idx ON public.leads(litigator) WHERE litigator;