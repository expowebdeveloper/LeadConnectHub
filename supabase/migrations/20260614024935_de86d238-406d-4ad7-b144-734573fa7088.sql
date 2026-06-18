
-- Helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
$$;

-- ai_conversations
CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  context_kind text NOT NULL DEFAULT 'global' CHECK (context_kind IN ('global','lead','agent','vendor','dashboard')),
  context_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_conversations TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage own ai conversations" ON public.ai_conversations
  FOR ALL TO authenticated
  USING (public.is_admin() AND owner_id = auth.uid())
  WITH CHECK (public.is_admin() AND owner_id = auth.uid());

-- ai_messages
CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_id text,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON public.ai_messages(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins access messages in own conversations" ON public.ai_messages
  FOR ALL TO authenticated
  USING (public.is_admin() AND EXISTS (
    SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.owner_id = auth.uid()
  ))
  WITH CHECK (public.is_admin() AND EXISTS (
    SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.owner_id = auth.uid()
  ));

-- ai_audit_log
CREATE TABLE public.ai_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  question text,
  tool_name text,
  tool_input jsonb,
  tool_output_summary text,
  data_sources text[],
  action_taken text,
  confidence text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_audit_log_user_idx ON public.ai_audit_log(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.ai_audit_log TO authenticated;
GRANT ALL ON public.ai_audit_log TO service_role;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit log" ON public.ai_audit_log
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admins insert audit log" ON public.ai_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND (user_id IS NULL OR user_id = auth.uid()));

-- ai_settings (single row)
CREATE TABLE public.ai_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_auto_goal integer NOT NULL DEFAULT 200,
  close_rate_target numeric NOT NULL DEFAULT 0.10,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ai settings" ON public.ai_settings
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admins update ai settings" ON public.ai_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ai_pinned_insights
CREATE TABLE public.ai_pinned_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  pinned_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_pinned_insights TO authenticated;
GRANT ALL ON public.ai_pinned_insights TO service_role;
ALTER TABLE public.ai_pinned_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage pinned insights" ON public.ai_pinned_insights
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ai_alerts
CREATE TABLE public.ai_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_alerts_unresolved_idx ON public.ai_alerts(created_at DESC) WHERE resolved_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.ai_alerts TO authenticated;
GRANT ALL ON public.ai_alerts TO service_role;
ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read alerts" ON public.ai_alerts
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admins update alerts" ON public.ai_alerts
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- updated_at trigger for conversations
CREATE OR REPLACE FUNCTION public.touch_ai_conversation_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_conversation_updated_at();
