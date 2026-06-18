ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS release_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_released_at timestamptz;