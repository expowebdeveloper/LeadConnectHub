
-- 1) Litigator cache: restrict SELECT to admins only
DROP POLICY IF EXISTS "Authenticated can read litigator cache" ON public.litigator_cache;
CREATE POLICY "Admins can read litigator cache"
  ON public.litigator_cache
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Profiles: tighten vendor sub-agent update policy + block sensitive field edits
DROP POLICY IF EXISTS "Vendors update sub-agents" ON public.profiles;
CREATE POLICY "Vendors update sub-agents"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (parent_vendor_id = auth.uid())
  WITH CHECK (parent_vendor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.prevent_vendor_sensitive_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins bypass
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Users editing their own profile bypass this check
  IF NEW.id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- For all other updaters (vendors editing sub-agents), block sensitive field changes
  IF NEW.parent_vendor_id IS DISTINCT FROM OLD.parent_vendor_id
     OR NEW.requested_role IS DISTINCT FROM OLD.requested_role
     OR NEW.bypass_litigator IS DISTINCT FROM OLD.bypass_litigator
     OR NEW.default_lead_rate IS DISTINCT FROM OLD.default_lead_rate
     OR NEW.frozen IS DISTINCT FROM OLD.frozen
     OR NEW.frozen_reason IS DISTINCT FROM OLD.frozen_reason
     OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
     OR NEW.min_vehicles IS DISTINCT FROM OLD.min_vehicles
     OR NEW.max_age IS DISTINCT FROM OLD.max_age
     OR NEW.telemarketer_goal_calls IS DISTINCT FROM OLD.telemarketer_goal_calls
     OR NEW.telemarketer_goal_transfers IS DISTINCT FROM OLD.telemarketer_goal_transfers
     OR NEW.telemarketer_goal_period IS DISTINCT FROM OLD.telemarketer_goal_period
     OR NEW.email IS DISTINCT FROM OLD.email
  THEN
    RAISE EXCEPTION 'Vendors cannot modify sensitive profile fields on sub-agents';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_vendor_sensitive_profile_changes ON public.profiles;
CREATE TRIGGER trg_prevent_vendor_sensitive_profile_changes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vendor_sensitive_profile_changes();

-- 3) Revoke public EXECUTE on internal trigger helper function
REVOKE EXECUTE ON FUNCTION public.coerce_lead_vendor_to_parent() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.coerce_lead_vendor_to_parent() FROM anon;
REVOKE EXECUTE ON FUNCTION public.coerce_lead_vendor_to_parent() FROM authenticated;
