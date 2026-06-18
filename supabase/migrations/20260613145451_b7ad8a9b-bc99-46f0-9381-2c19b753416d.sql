CREATE TABLE public.aircall_user_links (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  aircall_user_id BIGINT NOT NULL,
  aircall_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aircall_user_links TO authenticated;
GRANT ALL ON public.aircall_user_links TO service_role;
ALTER TABLE public.aircall_user_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own aircall link"
  ON public.aircall_user_links FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage aircall links"
  ON public.aircall_user_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_aircall_user_links_updated_at
  BEFORE UPDATE ON public.aircall_user_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE UNIQUE INDEX aircall_user_links_aircall_user_id_idx
  ON public.aircall_user_links(aircall_user_id);


CREATE TABLE public.aircall_calls (
  aircall_call_id BIGINT NOT NULL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id UUID,
  lead_table TEXT CHECK (lead_table IN ('leads','list_leads')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  voicemail_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.aircall_calls TO authenticated;
GRANT ALL ON public.aircall_calls TO service_role;
ALTER TABLE public.aircall_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own aircall calls"
  ON public.aircall_calls FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_aircall_calls_updated_at
  BEFORE UPDATE ON public.aircall_calls
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX aircall_calls_user_started_idx ON public.aircall_calls(user_id, started_at DESC);
CREATE INDEX aircall_calls_lead_idx ON public.aircall_calls(lead_id) WHERE lead_id IS NOT NULL;