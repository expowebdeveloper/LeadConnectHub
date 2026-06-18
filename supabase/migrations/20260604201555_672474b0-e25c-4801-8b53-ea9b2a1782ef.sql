ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.list_leads REPLICA IDENTITY FULL;
ALTER TABLE public.lead_shares REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.list_leads;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_shares;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;