
-- 1. parent_vendor_id on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS parent_vendor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_parent_vendor_id ON public.profiles(parent_vendor_id);

-- 2. Security-definer helper: parent vendor id for a user
CREATE OR REPLACE FUNCTION public.get_parent_vendor_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT parent_vendor_id FROM public.profiles WHERE id = _user_id
$$;
REVOKE EXECUTE ON FUNCTION public.get_parent_vendor_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_parent_vendor_id(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_parent_vendor_id(uuid) TO authenticated, service_role;

-- 3. Update leads INSERT policy: sub-agent may insert with vendor_id = parent
DROP POLICY IF EXISTS "Vendors insert own leads" ON public.leads;
CREATE POLICY "Vendors insert own leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (vendor_id = auth.uid() OR vendor_id = public.get_parent_vendor_id(auth.uid()))
    AND (has_role(auth.uid(), 'vendor') OR has_role(auth.uid(), 'sales') OR has_role(auth.uid(), 'admin'))
  );

-- 4. BEFORE INSERT trigger forces vendor_id = parent when inserter is a sub-agent
CREATE OR REPLACE FUNCTION public.coerce_lead_vendor_to_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pvid uuid;
BEGIN
  SELECT parent_vendor_id INTO pvid FROM public.profiles WHERE id = auth.uid();
  IF pvid IS NOT NULL THEN
    NEW.vendor_id := pvid;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS coerce_lead_vendor_to_parent ON public.leads;
CREATE TRIGGER coerce_lead_vendor_to_parent
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.coerce_lead_vendor_to_parent();

-- 5. Vendors can view their own sub-agents' profiles
DROP POLICY IF EXISTS "Vendors view sub-agents" ON public.profiles;
CREATE POLICY "Vendors view sub-agents" ON public.profiles
  FOR SELECT TO authenticated
  USING (parent_vendor_id = auth.uid());

-- Vendors can update sub-agent profile fields (e.g. unlink) limited via WITH CHECK
DROP POLICY IF EXISTS "Vendors update sub-agents" ON public.profiles;
CREATE POLICY "Vendors update sub-agents" ON public.profiles
  FOR UPDATE TO authenticated
  USING (parent_vendor_id = auth.uid())
  WITH CHECK (parent_vendor_id = auth.uid() OR parent_vendor_id IS NULL);

-- 6. vendor_invites table
CREATE TABLE IF NOT EXISTS public.vendor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_invites_vendor_id ON public.vendor_invites(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invites_token ON public.vendor_invites(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_invites TO authenticated;
GRANT ALL ON public.vendor_invites TO service_role;

ALTER TABLE public.vendor_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor manages own invites" ON public.vendor_invites;
CREATE POLICY "Vendor manages own invites" ON public.vendor_invites
  FOR ALL TO authenticated
  USING (vendor_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (vendor_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- 7. Update handle_new_user to consume an invite token from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  invite_token text;
  inv_vendor uuid;
  inv_id uuid;
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

  INSERT INTO public.profiles (id, email, full_name, company_name, requested_role, parent_vendor_id)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company_name',
    COALESCE(NEW.raw_user_meta_data->>'requested_role',
             CASE WHEN inv_vendor IS NOT NULL THEN 'vendor' END),
    inv_vendor
  );

  IF inv_vendor IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'vendor');
    UPDATE public.vendor_invites SET used_by = NEW.id, used_at = now() WHERE id = inv_id;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'pending');
  END IF;

  RETURN NEW;
END $$;
