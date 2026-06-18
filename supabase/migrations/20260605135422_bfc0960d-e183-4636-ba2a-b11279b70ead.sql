CREATE OR REPLACE FUNCTION public.prevent_vendor_sensitive_profile_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service-role / server-side updates (no auth context) bypass.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins bypass.
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Users editing their own profile bypass.
  IF NEW.id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- For all other updaters (vendors editing sub-agents), block sensitive field changes.
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
$function$;