-- Lists that don't stop at 1,000 rows (ONE-110).
--
-- The API returns at most max_rows = 1000 rows per request. Several reads
-- asked for everything and never paged, so past 1,000 they silently lost rows:
--
--   - a chat thread read oldest first, so a long one lost its newest messages;
--   - the Messages list read every message to order its conversations, so one
--     older than the newest 1,000 messages sank to the bottom as if never
--     messaged (ONE-106 had kept it in the list);
--   - follow and request state read every username, so past 1,000 follows a
--     Follow button read wrong.
--
-- Now a thread is read a page at a time, newest first, and the Messages list
-- and follow state are answered in the database. The Saves tab pages in the
-- app (features/saves/api.ts). Every function runs as the caller, so RLS
-- still decides: messages, follow requests and follows are read exactly as
-- before.

-- ─── One page of a conversation, newest first ─────────────────────────
--
-- The cursor is the oldest message already shown: (created_at, id), so two
-- messages with one timestamp are never skipped. Given only a time, the row
-- comparison is unknown at that time exactly, so it reads what came before.
-- The app reads each page with its own select string and reverses it.

CREATE OR REPLACE FUNCTION public.messages_thread(
    p_profile UUID,
    p_other UUID,
    p_before TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.messages
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT m.*
  FROM public.messages m
  WHERE ((m.sender_id = p_profile AND m.receiver_id = p_other)
      OR (m.sender_id = p_other AND m.receiver_id = p_profile))
    AND (p_before IS NULL OR (m.created_at, m.id) < (p_before, p_before_id))
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- ─── The Messages list ────────────────────────────────────────────────
--
-- Everyone the profile has messaged, either way, with when the latest message
-- between them was sent, newest conversation first. It replaces
-- chat_partners (ONE-106), which returned the partners but left the app to
-- read every message to order them.

DROP FUNCTION public.chat_partners(UUID);

CREATE OR REPLACE FUNCTION public.chat_list(p_profile UUID)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    username TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN,
    last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH latest AS (
    SELECT
      CASE WHEN m.sender_id = p_profile THEN m.receiver_id ELSE m.sender_id END AS partner_id,
      max(m.created_at) AS last_at
    FROM public.messages m
    WHERE m.sender_id = p_profile OR m.receiver_id = p_profile
    GROUP BY 1
  )
  SELECT p.id, p.full_name, p.username, p.avatar_url, p.is_verified, latest.last_at
  FROM latest
  JOIN public.profiles p ON p.id = latest.partner_id
  ORDER BY latest.last_at DESC, p.id;
$$;

-- ─── Follow and request state, as one row each ────────────────────────
--
-- A single array is one row, so no row cap reaches it, however many
-- usernames it holds. Lowercased, as the app compares them.

CREATE OR REPLACE FUNCTION public.following_usernames(p_viewer UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT lower(p.username)), '{}')
  FROM public.follows f
  JOIN public.profiles p ON p.id = f.followed_id
  WHERE f.follower_id = p_viewer
    AND btrim(p.username) <> '';
$$;

CREATE OR REPLACE FUNCTION public.requested_usernames(p_requester UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT lower(p.username)), '{}')
  FROM public.follow_requests r
  JOIN public.profiles p ON p.id = r.target_profile_id
  WHERE r.requester_profile_id = p_requester
    AND btrim(p.username) <> '';
$$;

REVOKE ALL ON FUNCTION public.messages_thread(UUID, UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_list(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.following_usernames(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.requested_usernames(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_thread(UUID, UUID, TIMESTAMPTZ, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.following_usernames(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.requested_usernames(UUID) TO authenticated;
