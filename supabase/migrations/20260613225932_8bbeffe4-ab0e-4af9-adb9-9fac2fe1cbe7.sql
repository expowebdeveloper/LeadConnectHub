
-- Chat Vault Stage 2/3 schema additions

-- Mentions
CREATE TABLE public.chat_message_mentions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  mentioned_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  mention_type TEXT NOT NULL DEFAULT 'user' CHECK (mention_type IN ('user','channel','here')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_mentions_user_idx ON public.chat_message_mentions (mentioned_user_id, read_at);
CREATE INDEX chat_mentions_msg_idx ON public.chat_message_mentions (message_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_mentions TO authenticated;
GRANT ALL ON public.chat_message_mentions TO service_role;

ALTER TABLE public.chat_message_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY mentions_select_self_or_member ON public.chat_message_mentions
  FOR SELECT TO authenticated
  USING (
    mentioned_user_id = auth.uid()
    OR public.chat_is_member(conversation_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY mentions_insert_member ON public.chat_message_mentions
  FOR INSERT TO authenticated
  WITH CHECK (public.chat_is_member(conversation_id, auth.uid()));

CREATE POLICY mentions_update_self ON public.chat_message_mentions
  FOR UPDATE TO authenticated
  USING (mentioned_user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_mentions;

-- Lead-linked conversations
CREATE TABLE public.chat_lead_conversations (
  lead_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, conversation_id)
);
CREATE INDEX chat_lead_conv_lead_idx ON public.chat_lead_conversations (lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_lead_conversations TO authenticated;
GRANT ALL ON public.chat_lead_conversations TO service_role;

ALTER TABLE public.chat_lead_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_conv_select_member ON public.chat_lead_conversations
  FOR SELECT TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY lead_conv_insert_member ON public.chat_lead_conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.chat_is_member(conversation_id, auth.uid()));

-- Audit log
CREATE TABLE public.chat_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  conversation_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_audit_created_idx ON public.chat_audit_log (created_at DESC);

GRANT SELECT, INSERT ON public.chat_audit_log TO authenticated;
GRANT ALL ON public.chat_audit_log TO service_role;

ALTER TABLE public.chat_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_select_admin ON public.chat_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY audit_insert_self ON public.chat_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- Full-text search index for message bodies
CREATE INDEX IF NOT EXISTS chat_messages_body_fts_idx
  ON public.chat_messages
  USING gin (to_tsvector('english', coalesce(body, '')));

-- Custom status emoji on presence (text status already exists)
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS status_emoji TEXT;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS status_clear_at TIMESTAMPTZ;
