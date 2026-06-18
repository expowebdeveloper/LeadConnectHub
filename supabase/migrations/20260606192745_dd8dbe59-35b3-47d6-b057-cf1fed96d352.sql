
-- 1) Tighten list_leads SELECT: telemarketers only see unclaimed or self-claimed
DROP POLICY IF EXISTS "View list leads" ON public.list_leads;
CREATE POLICY "View list leads"
  ON public.list_leads
  FOR SELECT
  TO authenticated
  USING (
    vendor_id = auth.uid()
    OR has_role(auth.uid(), 'sales'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'telemarketer'::app_role)
      AND (claimed_by IS NULL OR claimed_by = auth.uid())
    )
  );

-- 2) Restrict user_roles SELECT: drop the sales-can-read-all clause
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- 3) Revoke public EXECUTE on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.calc_lead_score(
  uuid, text, text, text, integer, text, text, date,
  timestamp with time zone, text, text, text[], integer, integer, numeric, boolean
) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.leads_score_trg() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_leads_score_trg() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_vendor_sensitive_profile_changes() FROM PUBLIC, anon;
