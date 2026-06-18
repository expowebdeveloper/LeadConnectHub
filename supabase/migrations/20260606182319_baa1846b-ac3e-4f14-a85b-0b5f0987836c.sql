
ALTER TABLE public.leads
  ADD COLUMN housing_status text CHECK (housing_status IN ('homeowner','renter')),
  ADD COLUMN auto_policies_count integer NOT NULL DEFAULT 0,
  ADD COLUMN home_policies_count integer NOT NULL DEFAULT 0,
  ADD COLUMN home_dispo lead_dispo,
  ADD COLUMN home_claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN home_claimed_at timestamptz,
  ADD COLUMN home_quoted_premium numeric(10,2),
  ADD COLUMN home_follow_up_at timestamptz,
  ADD COLUMN home_x_date date,
  ADD COLUMN home_agent_notes text;

CREATE INDEX idx_leads_home_claimed_by ON public.leads(home_claimed_by);
CREATE INDEX idx_leads_home_follow_up_at ON public.leads(home_follow_up_at) WHERE home_follow_up_at IS NOT NULL;

ALTER TABLE public.list_leads
  ADD COLUMN housing_status text CHECK (housing_status IN ('homeowner','renter')),
  ADD COLUMN auto_policies_count integer NOT NULL DEFAULT 0,
  ADD COLUMN home_policies_count integer NOT NULL DEFAULT 0,
  ADD COLUMN home_dispo lead_dispo,
  ADD COLUMN home_claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN home_claimed_at timestamptz,
  ADD COLUMN home_quoted_premium numeric(10,2),
  ADD COLUMN home_follow_up_at timestamptz,
  ADD COLUMN home_x_date date,
  ADD COLUMN home_agent_notes text;

CREATE INDEX idx_list_leads_home_claimed_by ON public.list_leads(home_claimed_by);
CREATE INDEX idx_list_leads_home_follow_up_at ON public.list_leads(home_follow_up_at) WHERE home_follow_up_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_lead_claim_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NOT NULL AND OLD.claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'This lead (auto) is already claimed by another agent';
      END IF;
      IF OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NULL AND OLD.claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'Only the agent who claimed the auto side can release it';
      END IF;
    END IF;
  END IF;

  IF NEW.home_claimed_by IS DISTINCT FROM OLD.home_claimed_by THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF OLD.home_claimed_by IS NOT NULL AND NEW.home_claimed_by IS NOT NULL AND OLD.home_claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'The home side of this lead is already claimed by another agent';
      END IF;
      IF OLD.home_claimed_by IS NOT NULL AND NEW.home_claimed_by IS NULL AND OLD.home_claimed_by <> auth.uid() THEN
        RAISE EXCEPTION 'Only the agent who claimed the home side can release it';
      END IF;
    END IF;
    IF NEW.home_claimed_by IS NULL THEN
      NEW.home_claimed_at := NULL;
    ELSE
      NEW.home_claimed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_lead_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tbl text := TG_TABLE_NAME;
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    IF NEW.claimed_by IS NOT NULL AND OLD.claimed_by IS NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'claimed', jsonb_build_object('side','auto','claimed_by', NEW.claimed_by));
    ELSIF NEW.claimed_by IS NULL AND OLD.claimed_by IS NOT NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'released', jsonb_build_object('side','auto','was_claimed_by', OLD.claimed_by));
    ELSE
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'reassigned', jsonb_build_object('side','auto','from', OLD.claimed_by, 'to', NEW.claimed_by));
    END IF;
  END IF;

  IF NEW.home_claimed_by IS DISTINCT FROM OLD.home_claimed_by THEN
    IF NEW.home_claimed_by IS NOT NULL AND OLD.home_claimed_by IS NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'claimed', jsonb_build_object('side','home','claimed_by', NEW.home_claimed_by));
    ELSIF NEW.home_claimed_by IS NULL AND OLD.home_claimed_by IS NOT NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'released', jsonb_build_object('side','home','was_claimed_by', OLD.home_claimed_by));
    ELSE
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'reassigned', jsonb_build_object('side','home','from', OLD.home_claimed_by, 'to', NEW.home_claimed_by));
    END IF;
  END IF;

  IF NEW.dispo IS DISTINCT FROM OLD.dispo THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'dispo_changed', jsonb_build_object('side','auto','from', OLD.dispo, 'to', NEW.dispo));
  END IF;

  IF NEW.home_dispo IS DISTINCT FROM OLD.home_dispo THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'dispo_changed', jsonb_build_object('side','home','from', OLD.home_dispo, 'to', NEW.home_dispo));
  END IF;

  IF NEW.quoted_premium IS DISTINCT FROM OLD.quoted_premium THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'quoted_premium_changed', jsonb_build_object('side','auto','from', OLD.quoted_premium, 'to', NEW.quoted_premium));
  END IF;

  IF NEW.home_quoted_premium IS DISTINCT FROM OLD.home_quoted_premium THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'quoted_premium_changed', jsonb_build_object('side','home','from', OLD.home_quoted_premium, 'to', NEW.home_quoted_premium));
  END IF;

  IF NEW.agent_notes IS DISTINCT FROM OLD.agent_notes THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'agent_notes_edited', jsonb_build_object('side','auto'));
  END IF;

  IF NEW.home_agent_notes IS DISTINCT FROM OLD.home_agent_notes THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'agent_notes_edited', jsonb_build_object('side','home'));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_vendor_agent_notes_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'vendor') AND NOT public.has_role(auth.uid(), 'sales') AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.agent_notes IS DISTINCT FROM OLD.agent_notes THEN
      RAISE EXCEPTION 'Sales agent notes are locked and cannot be modified by vendors';
    END IF;
    IF NEW.home_agent_notes IS DISTINCT FROM OLD.home_agent_notes THEN
      RAISE EXCEPTION 'Sales agent notes are locked and cannot be modified by vendors';
    END IF;
    IF NEW.dispo IS DISTINCT FROM OLD.dispo THEN
      RAISE EXCEPTION 'Dispo is locked and cannot be modified by vendors';
    END IF;
    IF NEW.home_dispo IS DISTINCT FROM OLD.home_dispo THEN
      RAISE EXCEPTION 'Dispo is locked and cannot be modified by vendors';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
