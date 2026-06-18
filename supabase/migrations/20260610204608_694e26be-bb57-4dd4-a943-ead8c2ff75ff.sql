
ALTER TABLE public.leads DROP CONSTRAINT leads_vendor_id_fkey,
  ADD CONSTRAINT leads_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_updated_by_fkey,
  ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.list_leads DROP CONSTRAINT IF EXISTS list_leads_vendor_id_fkey,
  ADD CONSTRAINT list_leads_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.leads ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE public.list_leads ALTER COLUMN vendor_id DROP NOT NULL;
