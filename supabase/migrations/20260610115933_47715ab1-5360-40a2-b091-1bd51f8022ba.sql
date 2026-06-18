DROP POLICY IF EXISTS "Vendors view their own post tokens" ON public.vendor_post_tokens;
CREATE POLICY "Vendors view their own post tokens"
ON public.vendor_post_tokens
FOR SELECT
TO authenticated
USING (vendor_id = auth.uid());

ALTER FUNCTION public._format_list_type(text) SET search_path = public;