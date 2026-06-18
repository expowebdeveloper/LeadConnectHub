
CREATE OR REPLACE FUNCTION public.leads_track_no_connect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.action <> 'call_logged' THEN RETURN NEW; END IF;
  IF coalesce(NEW.lead_table, '') <> 'leads' THEN RETURN NEW; END IF;
  v_outcome := coalesce(NEW.details->>'outcome', '');

  IF v_outcome IN ('connected','connected_sold','connected_quoted','connected_follow_up','connected_not_interested') THEN
    UPDATE public.leads
      SET no_connect_calls = 0,
          last_no_connect_at = NULL
    WHERE id = NEW.lead_id
      AND (no_connect_calls > 0 OR last_no_connect_at IS NOT NULL);

    -- Auto-claim for the agent who connected, if unclaimed
    IF NEW.user_id IS NOT NULL THEN
      UPDATE public.leads
        SET claimed_by = NEW.user_id,
            claimed_at = now()
      WHERE id = NEW.lead_id
        AND claimed_by IS NULL
        AND archived_at IS NULL;
    END IF;
  ELSIF v_outcome IN ('voicemail','busy','no_answer','no_answer_no_vm','callback_requested') THEN
    UPDATE public.leads
      SET no_connect_calls = coalesce(no_connect_calls, 0) + 1,
          last_no_connect_at = now()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;
