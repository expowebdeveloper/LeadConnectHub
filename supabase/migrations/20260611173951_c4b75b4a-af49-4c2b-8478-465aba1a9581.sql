
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS manual_status text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS manual_status_until timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS manual_status_note text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manual_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_manual_status_check
  CHECK (manual_status IS NULL OR manual_status = ANY (ARRAY['available','lunch','break','meeting','dnd','offline']));

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
