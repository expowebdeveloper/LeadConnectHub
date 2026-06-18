-- 1. dnc_cache: restrict SELECT to admins (service role bypasses RLS)
DROP POLICY IF EXISTS "Authenticated can view dnc cache" ON public.dnc_cache;
CREATE POLICY "Admins can view dnc cache"
ON public.dnc_cache
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. profiles: add WITH CHECK to admin update policy
DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;
CREATE POLICY "Admins update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Lock down SECURITY DEFINER functions that should not be exposed via the API.
-- Trigger functions (only invoked by triggers):
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_default_vendor_payout() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_vendor_agent_notes_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_lead_claim_transition() FROM PUBLIC, anon, authenticated;

-- Email queue helpers (only used by service role / server code):
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Set fixed search_path on email queue helpers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
