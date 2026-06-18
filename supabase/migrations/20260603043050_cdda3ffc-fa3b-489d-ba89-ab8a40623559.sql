DROP INDEX IF EXISTS public.list_leads_phone_unique;
CREATE UNIQUE INDEX list_leads_phone_unique ON public.list_leads(phone);