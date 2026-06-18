CREATE TABLE public.telnyx_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text,
  telnyx_event_id text UNIQUE,
  call_control_id text,
  call_session_id text,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.telnyx_webhook_events TO service_role;

ALTER TABLE public.telnyx_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX telnyx_webhook_events_ccid_idx ON public.telnyx_webhook_events (call_control_id);
CREATE INDEX telnyx_webhook_events_created_idx ON public.telnyx_webhook_events (created_at DESC);

-- No CREATE POLICY: end-users have no access. Only service_role (server) writes/reads.