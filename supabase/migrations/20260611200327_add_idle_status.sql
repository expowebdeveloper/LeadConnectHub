ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manual_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_manual_status_check
  CHECK (
    manual_status IS NULL
    OR manual_status = ANY (ARRAY[
      'available'::text,'lunch'::text,'break'::text,'meeting'::text,
      'dnd'::text,'offline'::text,'idle'::text
    ])
  );
