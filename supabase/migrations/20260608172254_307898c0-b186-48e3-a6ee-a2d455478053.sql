
ALTER TABLE public.vendor_post_tokens
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'shark_tank'
    CHECK (destination IN ('live', 'shark_tank'));

UPDATE public.vendor_post_tokens
SET destination = 'live'
WHERE vendor_id = 'c6e39510-73cd-4945-bad9-6b0d290725b7';
