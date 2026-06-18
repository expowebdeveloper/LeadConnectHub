
CREATE TABLE public.vendor_post_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.vendor_post_tokens(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  reason text NOT NULL,
  phone text,
  first_name text,
  last_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_post_rejections_vendor_created
  ON public.vendor_post_rejections (vendor_id, created_at DESC);

GRANT SELECT ON public.vendor_post_rejections TO authenticated;
GRANT ALL ON public.vendor_post_rejections TO service_role;

ALTER TABLE public.vendor_post_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors see their own rejections"
  ON public.vendor_post_rejections
  FOR SELECT
  TO authenticated
  USING (
    vendor_id = COALESCE(
      (SELECT parent_vendor_id FROM public.profiles WHERE id = auth.uid()),
      auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );
