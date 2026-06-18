-- 1) Profile goal fields for telemarketers
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telemarketer_goal_calls integer,
  ADD COLUMN IF NOT EXISTS telemarketer_goal_transfers integer,
  ADD COLUMN IF NOT EXISTS telemarketer_goal_period text
    CHECK (telemarketer_goal_period IS NULL OR telemarketer_goal_period IN ('day','week','month'));

-- 2) Transfer tracking on list_leads
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS transferred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferred_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_list_leads_transferred_by ON public.list_leads(transferred_by);
CREATE INDEX IF NOT EXISTS idx_list_leads_transferred_at ON public.list_leads(transferred_at);

-- 3) Credit on live leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS transferred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_transferred_by ON public.leads(transferred_by);

-- 4) handle_new_user: accept telemarketer requested_role
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
END $function$;

-- 5) RLS on list_leads: extend SELECT to telemarketers; allow them to UPDATE
DROP POLICY IF EXISTS "Vendors view own list leads, sales/admin view all" ON public.list_leads;
CREATE POLICY "View list leads"
  ON public.list_leads FOR SELECT
  TO authenticated
  USING (
    (vendor_id = auth.uid())
    OR public.has_role(auth.uid(), 'sales')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'telemarketer')
  );

CREATE POLICY "Telemarketers update list leads they claimed"
  ON public.list_leads FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'telemarketer')
    AND (claimed_by IS NULL OR claimed_by = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'telemarketer')
    AND (claimed_by IS NULL OR claimed_by = auth.uid())
  );

-- 6) RLS on leads: allow telemarketer-transferred inserts and viewing
DROP POLICY IF EXISTS "Vendors insert own leads" ON public.leads;
CREATE POLICY "Insert leads"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      ((vendor_id = auth.uid()) OR (vendor_id = public.get_parent_vendor_id(auth.uid())))
      AND (
        public.has_role(auth.uid(), 'vendor')
        OR public.has_role(auth.uid(), 'sales')
        OR public.has_role(auth.uid(), 'admin')
      )
    )
    OR (
      public.has_role(auth.uid(), 'telemarketer')
      AND transferred_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Vendors view own leads, sales/admin view all" ON public.leads;
CREATE POLICY "View leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    (vendor_id = auth.uid())
    OR public.has_role(auth.uid(), 'sales')
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'telemarketer') AND transferred_by = auth.uid())
  );

-- 7) lead_activities: telemarketers can log + view their own
DROP POLICY IF EXISTS "Sales and admins log activities" ON public.lead_activities;
CREATE POLICY "Log activities"
  ON public.lead_activities FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'sales')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'telemarketer')
    )
  );

DROP POLICY IF EXISTS "Sales and admins view activities" ON public.lead_activities;
CREATE POLICY "View activities"
  ON public.lead_activities FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales')
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'telemarketer') AND user_id = auth.uid())
  );

-- 8) profiles: telemarketers can view profiles (for vendor name / agent name lookups)
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "View profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.has_role(auth.uid(), 'sales')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'telemarketer')
  );
