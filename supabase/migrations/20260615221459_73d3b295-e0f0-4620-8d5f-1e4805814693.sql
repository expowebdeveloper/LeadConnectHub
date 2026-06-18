
CREATE TABLE public.presence_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.chat_presence_status NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX presence_events_started_at_idx ON public.presence_events (started_at DESC);
CREATE INDEX presence_events_user_started_idx ON public.presence_events (user_id, started_at DESC);

GRANT SELECT ON public.presence_events TO authenticated;
GRANT ALL ON public.presence_events TO service_role;

ALTER TABLE public.presence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presence_events_select_authed"
  ON public.presence_events FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.log_presence_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.presence_events (user_id, status, started_at)
    VALUES (NEW.user_id, NEW.status, COALESCE(NEW.updated_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_presence_log_event ON public.user_presence;
CREATE TRIGGER user_presence_log_event
  AFTER INSERT OR UPDATE OF status ON public.user_presence
  FOR EACH ROW
  EXECUTE FUNCTION public.log_presence_event();

-- Seed: snapshot the current presence so "now forward" has a baseline.
INSERT INTO public.presence_events (user_id, status, started_at)
SELECT user_id, status, COALESCE(updated_at, now())
FROM public.user_presence;
