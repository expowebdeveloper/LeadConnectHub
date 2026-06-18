
-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.chat_conversation_type AS ENUM ('channel','dm','group_dm','announcement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_member_role AS ENUM ('owner','admin','member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_message_type AS ENUM ('text','file','system','announcement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_presence_status AS ENUM ('online','away','busy','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  type public.chat_conversation_type NOT NULL DEFAULT 'channel',
  is_private boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  last_message_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX chat_conversations_type_idx ON public.chat_conversations(type);
CREATE INDEX chat_conversations_last_msg_idx ON public.chat_conversations(last_message_at DESC NULLS LAST);

-- ============================================================
-- MEMBERS
-- ============================================================
CREATE TABLE public.chat_conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.chat_member_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  muted boolean NOT NULL DEFAULT false,
  notification_level text NOT NULL DEFAULT 'all',
  UNIQUE (conversation_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversation_members TO authenticated;
GRANT ALL ON public.chat_conversation_members TO service_role;
ALTER TABLE public.chat_conversation_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX chat_members_user_idx ON public.chat_conversation_members(user_id);
CREATE INDEX chat_members_conv_idx ON public.chat_conversation_members(conversation_id);

-- ============================================================
-- SECURITY DEFINER: is the user a member?
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_is_member(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_conversation_members
    WHERE conversation_id = _conv AND user_id = _user
  );
$$;

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text,
  parent_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  message_type public.chat_message_type NOT NULL DEFAULT 'text',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX chat_messages_conv_created_idx ON public.chat_messages(conversation_id, created_at DESC);
CREATE INDEX chat_messages_parent_idx ON public.chat_messages(parent_message_id);

-- ============================================================
-- REACTIONS
-- ============================================================
CREATE TABLE public.chat_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_reactions TO authenticated;
GRANT ALL ON public.chat_message_reactions TO service_role;
ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX chat_reactions_msg_idx ON public.chat_message_reactions(message_id);

-- ============================================================
-- ATTACHMENTS
-- ============================================================
CREATE TABLE public.chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_attachments TO authenticated;
GRANT ALL ON public.chat_attachments TO service_role;
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX chat_attachments_msg_idx ON public.chat_attachments(message_id);
CREATE INDEX chat_attachments_conv_idx ON public.chat_attachments(conversation_id);

-- ============================================================
-- PINNED MESSAGES
-- ============================================================
CREATE TABLE public.chat_pinned_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  pinned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, message_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_pinned_messages TO authenticated;
GRANT ALL ON public.chat_pinned_messages TO service_role;
ALTER TABLE public.chat_pinned_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ANNOUNCEMENT ACKS
-- ============================================================
CREATE TABLE public.chat_announcement_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_announcement_acks TO authenticated;
GRANT ALL ON public.chat_announcement_acks TO service_role;
ALTER TABLE public.chat_announcement_acks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USER PRESENCE
-- ============================================================
CREATE TABLE public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.chat_presence_status NOT NULL DEFAULT 'offline',
  custom_status text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Conversations: members can read; anyone can create; only admins/owners can update
CREATE POLICY "conv_select_members" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (public.chat_is_member(id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "conv_insert_authed" ON public.chat_conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "conv_update_members" ON public.chat_conversations
  FOR UPDATE TO authenticated
  USING (public.chat_is_member(id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "conv_delete_admin" ON public.chat_conversations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Members: a user can see members of conversations they belong to; users can update their own membership rows
CREATE POLICY "members_select_in_conv" ON public.chat_conversation_members
  FOR SELECT TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "members_insert_self_or_admin" ON public.chat_conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.chat_is_member(conversation_id, auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

CREATE POLICY "members_update_self" ON public.chat_conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "members_delete_self_or_admin" ON public.chat_conversation_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Messages
CREATE POLICY "msg_select_members" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "msg_insert_members" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.chat_is_member(conversation_id, auth.uid())
  );

CREATE POLICY "msg_update_own" ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "msg_delete_own" ON public.chat_messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Reactions
CREATE POLICY "reactions_select_members" ON public.chat_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = message_id
        AND (public.chat_is_member(m.conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'))
    )
  );

CREATE POLICY "reactions_insert_own" ON public.chat_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reactions_delete_own" ON public.chat_message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Attachments
CREATE POLICY "att_select_members" ON public.chat_attachments
  FOR SELECT TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "att_insert_members" ON public.chat_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.chat_is_member(conversation_id, auth.uid())
  );

CREATE POLICY "att_delete_own_or_admin" ON public.chat_attachments
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Pins
CREATE POLICY "pin_select_members" ON public.chat_pinned_messages
  FOR SELECT TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "pin_insert_members" ON public.chat_pinned_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.chat_is_member(conversation_id, auth.uid()));

CREATE POLICY "pin_delete_members" ON public.chat_pinned_messages
  FOR DELETE TO authenticated
  USING (public.chat_is_member(conversation_id, auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- Announcement acks
CREATE POLICY "ack_select_self_or_admin" ON public.chat_announcement_acks
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = message_id AND public.chat_is_member(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "ack_insert_own" ON public.chat_announcement_acks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Presence: everyone authenticated can read; each user manages their own row
CREATE POLICY "presence_select_all_authed" ON public.user_presence
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "presence_upsert_own" ON public.user_presence
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "presence_update_own" ON public.user_presence
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- TRIGGERS: bump last_message_at + updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_conversations
    SET last_message_at = NEW.created_at,
        updated_at = now()
    WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_messages_after_insert_trg
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.chat_messages_after_insert();

CREATE OR REPLACE FUNCTION public.chat_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER chat_conversations_touch BEFORE UPDATE ON public.chat_conversations
FOR EACH ROW EXECUTE FUNCTION public.chat_touch_updated_at();

CREATE TRIGGER user_presence_touch BEFORE UPDATE ON public.user_presence
FOR EACH ROW EXECUTE FUNCTION public.chat_touch_updated_at();

-- ============================================================
-- REALTIME PUBLICATION
-- ============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversation_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.user_presence REPLICA IDENTITY FULL;

-- ============================================================
-- STORAGE: chat-attachments bucket policies
-- (bucket itself is created via the storage tool)
-- File path convention: <conversation_id>/<uuid>-<filename>
-- ============================================================
CREATE POLICY "chat_att_read_members" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.chat_is_member((split_part(name,'/',1))::uuid, auth.uid())
  );

CREATE POLICY "chat_att_insert_members" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND public.chat_is_member((split_part(name,'/',1))::uuid, auth.uid())
    AND owner = auth.uid()
  );

CREATE POLICY "chat_att_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
  );

-- ============================================================
-- SEED: system channels + add existing profiles
-- ============================================================
DO $$
DECLARE
  v_general uuid;
  v_announce uuid;
  v_wins uuid;
  v_shark uuid;
BEGIN
  INSERT INTO public.chat_conversations (name, type, is_private)
    VALUES ('general','channel', false) RETURNING id INTO v_general;
  INSERT INTO public.chat_conversations (name, type, is_private)
    VALUES ('announcements','announcement', false) RETURNING id INTO v_announce;
  INSERT INTO public.chat_conversations (name, type, is_private)
    VALUES ('wins','channel', false) RETURNING id INTO v_wins;
  INSERT INTO public.chat_conversations (name, type, is_private)
    VALUES ('shark-tank','channel', false) RETURNING id INTO v_shark;

  INSERT INTO public.chat_conversation_members (conversation_id, user_id, role)
    SELECT v_general, p.id, 'member'::public.chat_member_role FROM public.profiles p
    ON CONFLICT DO NOTHING;
  INSERT INTO public.chat_conversation_members (conversation_id, user_id, role)
    SELECT v_announce, p.id, 'member'::public.chat_member_role FROM public.profiles p
    ON CONFLICT DO NOTHING;
END $$;

-- Auto-add new users to #general and #announcements
CREATE OR REPLACE FUNCTION public.chat_autojoin_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chat_conversation_members (conversation_id, user_id, role)
    SELECT c.id, NEW.id, 'member'::public.chat_member_role
    FROM public.chat_conversations c
    WHERE c.type IN ('channel','announcement')
      AND c.is_private = false
      AND c.name IN ('general','announcements')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_chat_autojoin
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.chat_autojoin_new_user();
