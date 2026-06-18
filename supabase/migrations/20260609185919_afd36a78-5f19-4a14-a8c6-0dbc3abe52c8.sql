
-- Allow share recipients to read & update the shared lead even if their role
-- doesn't otherwise grant access.
CREATE OR REPLACE FUNCTION public.is_lead_shared_with(_lead_id uuid, _lead_table text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_shares
    WHERE lead_id = _lead_id
      AND lead_table = _lead_table
      AND shared_with = _user_id
  )
$$;

DROP POLICY IF EXISTS "Share recipients can view shared leads" ON public.leads;
CREATE POLICY "Share recipients can view shared leads"
  ON public.leads FOR SELECT
  USING (public.is_lead_shared_with(id, 'leads', auth.uid()));

DROP POLICY IF EXISTS "Share recipients can update shared leads" ON public.leads;
CREATE POLICY "Share recipients can update shared leads"
  ON public.leads FOR UPDATE
  USING (public.is_lead_shared_with(id, 'leads', auth.uid()))
  WITH CHECK (public.is_lead_shared_with(id, 'leads', auth.uid()));

DROP POLICY IF EXISTS "Share recipients can view shared list leads" ON public.list_leads;
CREATE POLICY "Share recipients can view shared list leads"
  ON public.list_leads FOR SELECT
  USING (public.is_lead_shared_with(id, 'list_leads', auth.uid()));

DROP POLICY IF EXISTS "Share recipients can update shared list leads" ON public.list_leads;
CREATE POLICY "Share recipients can update shared list leads"
  ON public.list_leads FOR UPDATE
  USING (public.is_lead_shared_with(id, 'list_leads', auth.uid()))
  WITH CHECK (public.is_lead_shared_with(id, 'list_leads', auth.uid()));
