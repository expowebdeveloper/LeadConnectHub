
-- 1) Profile column hardening: revoke admin-only financial/control fields from client reads.
REVOKE SELECT (bypass_litigator, default_lead_rate) ON public.profiles FROM authenticated;
REVOKE SELECT (bypass_litigator, default_lead_rate) ON public.profiles FROM anon;

-- 2) Storage: allow admins to replace optin-proof files.
DROP POLICY IF EXISTS "Admins update optin proofs" ON storage.objects;
CREATE POLICY "Admins update optin proofs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'optin-proofs' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'optin-proofs' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3) Zillow cache: scope visibility to users with real access to the underlying lead.
DROP POLICY IF EXISTS "Zillow cache visible when lead is visible" ON public.zillow_property_data;
CREATE POLICY "Zillow cache visible when lead is visible"
  ON public.zillow_property_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = zillow_property_data.lead_id
        AND (
          l.vendor_id = auth.uid()
          OR public.has_role(auth.uid(), 'sales'::public.app_role)
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (public.has_role(auth.uid(), 'telemarketer'::public.app_role) AND l.transferred_by = auth.uid())
          OR public.is_lead_shared_with(l.id, 'leads', auth.uid())
        )
    )
  );

-- 4) Revoke EXECUTE from anon/public on internal SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_line_claimer(uuid, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_line_shared_with(uuid, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_is_member(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_autojoin_new_user() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_messages_after_insert() FROM anon, PUBLIC;
