
CREATE OR REPLACE FUNCTION public.is_line_claimer(
  _lead_id uuid, _lead_table text, _line_id text, _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lines jsonb;
  v_claimer uuid;
BEGIN
  IF _line_id IS NULL OR _user_id IS NULL THEN RETURN false; END IF;

  -- Special sentinels: auto/home map to lead-level claim columns
  IF _line_id IN ('auto','home') THEN
    IF _lead_table = 'leads' THEN
      IF _line_id = 'auto' THEN
        SELECT claimed_by INTO v_claimer FROM public.leads WHERE id = _lead_id;
      ELSE
        SELECT home_claimed_by INTO v_claimer FROM public.leads WHERE id = _lead_id;
      END IF;
    ELSIF _lead_table = 'list_leads' THEN
      IF _line_id = 'auto' THEN
        SELECT claimed_by INTO v_claimer FROM public.list_leads WHERE id = _lead_id;
      ELSE
        SELECT home_claimed_by INTO v_claimer FROM public.list_leads WHERE id = _lead_id;
      END IF;
    ELSE
      RETURN false;
    END IF;
    RETURN v_claimer IS NOT NULL AND v_claimer = _user_id;
  END IF;

  -- Otherwise check lead_lines JSONB for the line's claimed_by
  IF _lead_table = 'leads' THEN
    SELECT lead_lines INTO v_lines FROM public.leads WHERE id = _lead_id;
  ELSIF _lead_table = 'list_leads' THEN
    SELECT lead_lines INTO v_lines FROM public.list_leads WHERE id = _lead_id;
  ELSE
    RETURN false;
  END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;
  SELECT NULLIF(elem->>'claimed_by','')::uuid INTO v_claimer
  FROM jsonb_array_elements(v_lines) elem
  WHERE elem->>'line_id' = _line_id
  LIMIT 1;
  RETURN v_claimer IS NOT NULL AND v_claimer = _user_id;
END;
$$;
