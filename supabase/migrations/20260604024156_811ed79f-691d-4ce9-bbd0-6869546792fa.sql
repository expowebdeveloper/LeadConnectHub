GRANT INSERT ON public.lead_activities TO authenticated;
CREATE POLICY "Sales and admins log activities"
ON public.lead_activities
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    has_role(auth.uid(), 'sales'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);