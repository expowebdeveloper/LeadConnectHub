-- Allow admins to insert leads on behalf of any vendor (fixes impersonation flow
-- and matches admin's general elevated privileges). Vendors/sub-agents still
-- restricted to themselves or their parent; sales restricted to their own uid;
-- telemarketers restricted to transferred_by.
DROP POLICY IF EXISTS "Insert leads" ON public.leads;
CREATE POLICY "Insert leads"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      (
        (vendor_id = auth.uid())
        OR (vendor_id = public.get_parent_vendor_id(auth.uid()))
      )
      AND (
        public.has_role(auth.uid(), 'vendor'::app_role)
        OR public.has_role(auth.uid(), 'sales'::app_role)
      )
    )
    OR (
      public.has_role(auth.uid(), 'telemarketer'::app_role)
      AND transferred_by = auth.uid()
    )
  );