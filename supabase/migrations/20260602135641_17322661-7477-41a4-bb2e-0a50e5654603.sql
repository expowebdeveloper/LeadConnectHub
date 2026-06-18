
CREATE POLICY "Vendors upload own optin proofs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'optin-proofs'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Vendors view own optin proofs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'optin-proofs'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY "Vendors delete own optin proofs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'optin-proofs'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
