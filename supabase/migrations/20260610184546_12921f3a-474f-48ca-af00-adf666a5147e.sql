ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS lead_activity_id uuid;

CREATE INDEX IF NOT EXISTS call_logs_agent_started_idx
  ON public.call_logs (agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS call_logs_lead_started_idx
  ON public.call_logs (lead_table, lead_id, started_at DESC);

CREATE INDEX IF NOT EXISTS call_logs_ccid_idx
  ON public.call_logs (telnyx_call_control_id);