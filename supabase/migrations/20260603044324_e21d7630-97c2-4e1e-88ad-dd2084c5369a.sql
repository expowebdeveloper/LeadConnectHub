
-- 1. dnc_cache: explicit service-role-only write policies
CREATE POLICY "Service role inserts dnc cache"
  ON public.dnc_cache FOR INSERT TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role updates dnc cache"
  ON public.dnc_cache FOR UPDATE TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role deletes dnc cache"
  ON public.dnc_cache FOR DELETE TO public
  USING (auth.role() = 'service_role');

-- 2. leads: ensure vendor-lock trigger is attached
DROP TRIGGER IF EXISTS prevent_vendor_agent_notes_update ON public.leads;
CREATE TRIGGER prevent_vendor_agent_notes_update
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vendor_agent_notes_update();

DROP TRIGGER IF EXISTS prevent_vendor_agent_notes_update ON public.list_leads;
CREATE TRIGGER prevent_vendor_agent_notes_update
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vendor_agent_notes_update();

-- Also enforce claim transitions
DROP TRIGGER IF EXISTS enforce_lead_claim_transition ON public.leads;
CREATE TRIGGER enforce_lead_claim_transition
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_lead_claim_transition();

DROP TRIGGER IF EXISTS enforce_lead_claim_transition ON public.list_leads;
CREATE TRIGGER enforce_lead_claim_transition
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_lead_claim_transition();

-- Default vendor payout trigger
DROP TRIGGER IF EXISTS apply_default_vendor_payout ON public.leads;
CREATE TRIGGER apply_default_vendor_payout
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_default_vendor_payout();

-- 3. optin-proofs bucket: add UPDATE policy
CREATE POLICY "Users update own optin proofs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'optin-proofs' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'optin-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 4. Revoke public/anon EXECUTE on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_default_vendor_payout() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_vendor_agent_notes_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_lead_claim_transition() FROM PUBLIC, anon, authenticated;
