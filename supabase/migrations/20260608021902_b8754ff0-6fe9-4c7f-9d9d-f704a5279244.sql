
-- 1. Goals: restrict SELECT to sales + admin
DROP POLICY IF EXISTS "Authenticated can read goals" ON public.goals;
CREATE POLICY "Sales and admins can read goals"
ON public.goals
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'sales'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 2. Revoke anon/public EXECUTE on SECURITY DEFINER functions that should not be callable from the API
REVOKE EXECUTE ON FUNCTION public.email_queue_health(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leads_on_sold_trg() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_sale_event(uuid, text, text, uuid, numeric, text, text) FROM anon, PUBLIC;

-- 3. Pin search_path on remaining functions that don't have one set
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = pgmq, public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = pgmq, public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = pgmq, public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = pgmq, public;
