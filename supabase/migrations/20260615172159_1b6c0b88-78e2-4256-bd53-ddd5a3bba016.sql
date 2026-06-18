
-- 1. Plivo endpoints: remove SELECT for authenticated; admins still have ALL via existing policy
DROP POLICY IF EXISTS "Users read own plivo endpoint" ON public.plivo_endpoints;

-- 2. Chat templates: tighten INSERT and SELECT
DROP POLICY IF EXISTS "insert own templates" ON public.chat_templates;
DROP POLICY IF EXISTS "read own or shared templates" ON public.chat_templates;

CREATE POLICY "insert own templates"
  ON public.chat_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner = auth.uid()
    OR (owner IS NULL AND public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "read own or shared templates"
  ON public.chat_templates
  FOR SELECT
  TO authenticated
  USING (
    owner = auth.uid()
    OR is_shared = true
    OR (owner IS NULL AND public.has_role(auth.uid(), 'admin'::app_role))
  );

-- 3. Revoke EXECUTE on SECURITY DEFINER functions from anon
REVOKE EXECUTE ON FUNCTION public.user_can_access_lead_for_notes(text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.clear_requires_dispo_on_dispo_change() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.finalize_stale_initiated_calls() FROM anon, public;
