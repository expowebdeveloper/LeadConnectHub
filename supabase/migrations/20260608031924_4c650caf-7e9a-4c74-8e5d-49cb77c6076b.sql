-- Per-agent Telnyx fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telnyx_number text,
  ADD COLUMN IF NOT EXISTS telnyx_sip_username text,
  ADD COLUMN IF NOT EXISTS telnyx_sip_password text;

-- Call logs
CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  lead_table text,
  agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  from_number text,
  to_number text,
  telnyx_call_control_id text,
  telnyx_call_leg_id text,
  telnyx_call_session_id text,
  status text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  hangup_cause text,
  recording_url text,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_lead_idx ON public.call_logs (lead_id);
CREATE INDEX IF NOT EXISTS call_logs_agent_idx ON public.call_logs (agent_id);
CREATE INDEX IF NOT EXISTS call_logs_ccid_idx ON public.call_logs (telnyx_call_control_id);
CREATE INDEX IF NOT EXISTS call_logs_created_idx ON public.call_logs (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents view their own call logs"
  ON public.call_logs FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents insert their own call logs"
  ON public.call_logs FOR INSERT
  TO authenticated
  WITH CHECK (agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents update their own call logs"
  ON public.call_logs FOR UPDATE
  TO authenticated
  USING (agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER call_logs_touch_updated_at
  BEFORE UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
