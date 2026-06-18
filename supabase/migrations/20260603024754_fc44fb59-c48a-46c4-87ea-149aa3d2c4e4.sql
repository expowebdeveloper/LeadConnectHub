DROP POLICY IF EXISTS "Vendors insert own list leads" ON public.list_leads;

CREATE POLICY "Vendors insert own list leads"
  ON public.list_leads FOR INSERT TO authenticated
  WITH CHECK (
    (
      vendor_id = auth.uid()
      AND public.has_role(auth.uid(), 'vendor'::app_role)
    )
    OR public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );