-- 1. Drop Aircall tables entirely (cascades policies, indexes, FKs)
DROP TABLE IF EXISTS public.aircall_calls CASCADE;
DROP TABLE IF EXISTS public.aircall_user_links CASCADE;

-- 2. Plivo: pgcrypto for endpoint password encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- 3. plivo_endpoints — per-user SIP endpoint credentials for Browser SDK login
CREATE TABLE public.plivo_endpoints (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint_username text NOT NULL UNIQUE,
  endpoint_alias text,
  caller_id text,
  endpoint_password_enc bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plivo_endpoints TO authenticated;
GRANT ALL ON public.plivo_endpoints TO service_role;

ALTER TABLE public.plivo_endpoints ENABLE ROW LEVEL SECURITY;

-- Owners can see their own row (NOTE: caller_id/username/alias only; password column is read via SECURITY DEFINER fn).
CREATE POLICY "Users read own plivo endpoint"
  ON public.plivo_endpoints FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage plivo endpoints"
  ON public.plivo_endpoints FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER plivo_endpoints_touch_updated_at
  BEFORE UPDATE ON public.plivo_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. plivo_calls — webhook-ingested call log
CREATE TABLE public.plivo_calls (
  call_uuid text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id uuid,
  lead_table text CHECK (lead_table IN ('leads','list_leads')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text,
  hangup_cause text,
  from_number text,
  to_number text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  recording_duration integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plivo_calls_user_started_idx ON public.plivo_calls (user_id, started_at DESC);
CREATE INDEX plivo_calls_lead_idx ON public.plivo_calls (lead_id) WHERE lead_id IS NOT NULL;

GRANT SELECT ON public.plivo_calls TO authenticated;
GRANT ALL ON public.plivo_calls TO service_role;

ALTER TABLE public.plivo_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own plivo calls"
  ON public.plivo_calls FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER plivo_calls_touch_updated_at
  BEFORE UPDATE ON public.plivo_calls
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
