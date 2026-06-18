
-- Restrict sale_events SELECT to sales/admin
DROP POLICY IF EXISTS "Authenticated read sale_events" ON public.sale_events;
CREATE POLICY "Sales and admins read sale_events"
ON public.sale_events
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'sales'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Remove telemarketer broad profile read
DROP POLICY IF EXISTS "View profiles" ON public.profiles;
CREATE POLICY "View profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR has_role(auth.uid(), 'sales'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);
