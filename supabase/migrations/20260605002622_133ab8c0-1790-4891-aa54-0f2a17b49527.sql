
ALTER TABLE public.profiles RENAME COLUMN bypass_dnc TO bypass_litigator;

DROP TABLE IF EXISTS public.dnc_cache;

CREATE TABLE public.litigator_cache (
  phone text PRIMARY KEY,
  is_litigator boolean NOT NULL DEFAULT false,
  raw_response jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.litigator_cache TO authenticated;
GRANT ALL ON public.litigator_cache TO service_role;

ALTER TABLE public.litigator_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read litigator cache"
  ON public.litigator_cache FOR SELECT
  TO authenticated USING (true);
