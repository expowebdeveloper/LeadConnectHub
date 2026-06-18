ALTER TABLE public.list_leads ADD COLUMN list_type text;
ALTER TABLE public.list_leads ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE public.list_leads ADD CONSTRAINT list_leads_list_type_check CHECK (list_type IN ('winback','requote','ivantage_no_allstate'));