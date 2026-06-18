
CREATE TABLE public.vendor_post_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  post_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_post_tokens_vendor ON public.vendor_post_tokens(vendor_id);
CREATE INDEX idx_vendor_post_tokens_token ON public.vendor_post_tokens(token);

GRANT SELECT ON public.vendor_post_tokens TO authenticated;
GRANT ALL ON public.vendor_post_tokens TO service_role;

ALTER TABLE public.vendor_post_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage post tokens"
  ON public.vendor_post_tokens FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Vendors view their own post tokens"
  ON public.vendor_post_tokens FOR SELECT
  TO authenticated
  USING (vendor_id = auth.uid() OR vendor_id = public.get_parent_vendor_id(auth.uid()));

CREATE TRIGGER vendor_post_tokens_touch
  BEFORE UPDATE ON public.vendor_post_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
