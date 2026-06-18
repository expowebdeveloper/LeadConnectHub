CREATE POLICY "Vendors delete own leads"
ON public.leads
FOR DELETE
TO authenticated
USING (vendor_id = auth.uid() AND has_role(auth.uid(), 'vendor'::app_role));