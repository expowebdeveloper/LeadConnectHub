
-- 1) Protect SIP credentials on profiles: revoke column SELECT from client roles.
--    Server functions use the service role and continue to work.
REVOKE SELECT (telnyx_sip_password, telnyx_sip_username) ON public.profiles FROM anon, authenticated;

-- 2) Tighten telemarketer update on list_leads: must claim themselves on update.
DROP POLICY IF EXISTS "Telemarketers update list leads they claimed" ON public.list_leads;
CREATE POLICY "Telemarketers update list leads they claimed"
ON public.list_leads
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'telemarketer'::app_role)
  AND (claimed_by IS NULL OR claimed_by = auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'telemarketer'::app_role)
  AND claimed_by = auth.uid()
);

-- 3) Add an admin-only SELECT policy on telnyx_webhook_events (RLS was on, no policies).
CREATE POLICY "Admins read telnyx webhook events"
ON public.telnyx_webhook_events
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.telnyx_webhook_events TO authenticated;

-- 4) Revoke EXECUTE on internal trigger helper from anon/public.
REVOKE EXECUTE ON FUNCTION public.leads_track_no_connect() FROM PUBLIC, anon, authenticated;
