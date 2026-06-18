ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS min_vehicles integer,
  ADD COLUMN IF NOT EXISTS max_age integer;