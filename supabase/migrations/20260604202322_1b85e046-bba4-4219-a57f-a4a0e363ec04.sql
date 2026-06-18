
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lead_claimer(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_lead_claimer(uuid, text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated can read settings" ON public.app_settings;
CREATE POLICY "Admins read settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Sales and admins update leads" ON public.leads;
CREATE POLICY "Sales and admins update leads"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'sales'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (
    (public.has_role(auth.uid(), 'sales'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
    AND vendor_id = (SELECT l.vendor_id FROM public.leads l WHERE l.id = leads.id)
  );

DROP POLICY IF EXISTS "Sales and admins update list leads" ON public.list_leads;
CREATE POLICY "Sales and admins update list leads"
  ON public.list_leads
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'sales'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (
    (public.has_role(auth.uid(), 'sales'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
    AND vendor_id IS NOT DISTINCT FROM (SELECT ll.vendor_id FROM public.list_leads ll WHERE ll.id = list_leads.id)
  );

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sales and admins can subscribe to realtime" ON realtime.messages;
CREATE POLICY "Sales and admins can subscribe to realtime"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
