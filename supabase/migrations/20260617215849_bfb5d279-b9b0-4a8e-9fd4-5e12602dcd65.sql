ALTER TABLE public.list_leads DROP CONSTRAINT IF EXISTS list_leads_list_type_check;
ALTER TABLE public.list_leads ADD CONSTRAINT list_leads_list_type_check
  CHECK (list_type IN ('winback','requote','ivantage_no_allstate','aged','anchorline','missed_transfer','manual_upload'));