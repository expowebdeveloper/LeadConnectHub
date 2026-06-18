
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS start_date date;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invite_token text;
  inv_vendor uuid;
  inv_id uuid;
  meta_dob date;
  meta_start date;
BEGIN
  invite_token := NEW.raw_user_meta_data->>'vendor_invite_token';
  IF invite_token IS NOT NULL AND length(invite_token) > 0 THEN
    SELECT id, vendor_id INTO inv_id, inv_vendor
    FROM public.vendor_invites
    WHERE token = invite_token
      AND used_by IS NULL
      AND expires_at > now()
    LIMIT 1;
  END IF;

  BEGIN
    meta_dob := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
  EXCEPTION WHEN OTHERS THEN
    meta_dob := NULL;
  END;
  BEGIN
    meta_start := NULLIF(NEW.raw_user_meta_data->>'start_date', '')::date;
  EXCEPTION WHEN OTHERS THEN
    meta_start := NULL;
  END;

  INSERT INTO public.profiles (id, email, full_name, company_name, requested_role, parent_vendor_id, date_of_birth, start_date)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company_name',
    COALESCE(NEW.raw_user_meta_data->>'requested_role',
             CASE WHEN inv_vendor IS NOT NULL THEN 'vendor' END),
    inv_vendor,
    meta_dob,
    meta_start
  );

  IF inv_vendor IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'vendor');
    UPDATE public.vendor_invites SET used_by = NEW.id, used_at = now() WHERE id = inv_id;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'pending');
  END IF;

  RETURN NEW;
END $function$;
