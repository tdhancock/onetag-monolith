-- The Messages list previews each conversation's latest message.
--
-- chat_list (ONE-110) answered who, and when the latest message was sent. The
-- list now also shows what that message was, as a line under the name: its
-- text, what kind of message it was, and who sent it, so the row reads
-- "You: see you then" or "Sent a post". It still finds each partner in the
-- database, so no conversation sinks behind the API's 1,000-row cap.
--
-- Adding columns changes the return type, which CREATE OR REPLACE can't do,
-- so the function is dropped and made again, and its grants given again.

DROP FUNCTION public.chat_list(UUID);

CREATE FUNCTION public.chat_list(p_profile UUID)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    username TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN,
    last_message_at TIMESTAMPTZ,
    last_message_text TEXT,
    last_message_type TEXT,
    last_message_sender_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- Each partner's newest message. Two sent in the same instant are told
  -- apart by id, as messages_thread orders them, so the preview is the
  -- message the thread shows last.
  WITH latest AS (
    SELECT DISTINCT ON (mine.partner_id)
      mine.partner_id, mine.created_at, mine.text, mine.type, mine.sender_id
    FROM (
      SELECT
        CASE WHEN m.sender_id = p_profile THEN m.receiver_id ELSE m.sender_id END AS partner_id,
        m.id, m.created_at, m.text, m.type, m.sender_id
      FROM public.messages m
      WHERE m.sender_id = p_profile OR m.receiver_id = p_profile
    ) mine
    ORDER BY mine.partner_id, mine.created_at DESC, mine.id DESC
  )
  SELECT p.id, p.full_name, p.username, p.avatar_url, p.is_verified,
         latest.created_at, latest.text, latest.type, latest.sender_id
  FROM latest
  JOIN public.profiles p ON p.id = latest.partner_id
  ORDER BY latest.created_at DESC, p.id;
$$;

REVOKE ALL ON FUNCTION public.chat_list(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_list(UUID) TO authenticated;
