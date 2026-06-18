
WITH conv_members AS (
  SELECT
    m.conversation_id,
    m.user_id,
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.role = 'admin')    AS is_admin,
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.role = 'vendor')   AS is_vendor,
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.role = 'sales')    AS is_sales,
    p.parent_vendor_id
  FROM public.chat_conversation_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
),
candidate_convs AS (
  SELECT c.id
  FROM public.chat_conversations c
  WHERE c.archived_at IS NULL
    AND c.type IN ('dm', 'group_dm', 'channel')
    AND NOT (c.type = 'channel' AND c.is_private = false)
    AND NOT EXISTS (
      SELECT 1 FROM conv_members cm WHERE cm.conversation_id = c.id AND cm.is_admin
    )
),
bad_convs AS (
  SELECT DISTINCT v.conversation_id
  FROM conv_members v
  JOIN candidate_convs cc ON cc.id = v.conversation_id
  JOIN conv_members s
    ON s.conversation_id = v.conversation_id
   AND s.user_id <> v.user_id
  WHERE v.is_vendor
    AND s.is_sales
    AND NOT s.is_vendor
    AND (s.parent_vendor_id IS DISTINCT FROM v.user_id)
)
UPDATE public.chat_conversations c
SET archived_at = now()
WHERE c.id IN (SELECT conversation_id FROM bad_convs);

INSERT INTO public.chat_messages (conversation_id, sender_id, body, message_type)
SELECT c.id, NULL,
       'This conversation was archived because vendor–agent direct chat is no longer allowed.',
       'system'
FROM public.chat_conversations c
WHERE c.archived_at IS NOT NULL
  AND c.archived_at >= now() - interval '1 minute'
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.conversation_id = c.id
      AND m.message_type = 'system'
      AND m.body = 'This conversation was archived because vendor–agent direct chat is no longer allowed.'
  );
