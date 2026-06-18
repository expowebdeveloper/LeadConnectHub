CREATE TABLE public.dnc_cache (
  phone text PRIMARY KEY,
  is_dnc boolean NOT NULL,
  raw_response jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dnc_cache TO authenticated;
GRANT ALL ON public.dnc_cache TO service_role;

ALTER TABLE public.dnc_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view dnc cache"
ON public.dnc_cache FOR SELECT TO authenticated
USING (true);