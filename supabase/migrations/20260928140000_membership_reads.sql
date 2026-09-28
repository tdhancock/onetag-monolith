-- Reads that no longer put an id list in the URL (ONE-106).
--
-- Several reads fetched a list of ids first — everyone the viewer follows,
-- every saved item, every conversation partner — and sent it back as
-- `.in(column, ids)`. PostgREST puts that in the request URL, and at about
-- 200 ids the gateway refuses it as "URI too long": the feed broke for
-- anyone following about 200 accounts.
--
-- Each read's membership test now happens in the database, in a function
-- whose arguments travel in the request body, never the URL. Each returns rows
-- of the table itself, so PostgREST embeds on it as it did on the table, and
-- each call site keeps its select string.
--
-- The feed only uses feed_posts to choose a page: the posts are then read from
-- the table by those ids, at most a page of them. PostgREST 14 mishandles a
-- filter on an embed of a function's result (it adds the filtered column to
-- the function's own columns), and the posts select filters its likes, reposts
-- and saves to the viewer that way. The Saves tab reads its targets by id in
-- batches instead (features/saves/api.ts).
--
-- Every function is SECURITY INVOKER: the caller's RLS applies unchanged.
-- Posts, stories and profiles are filtered as before. Messages and blocks are
-- readable only by their owner, so those functions only ever return the
-- caller's own. Each returns exactly the rows the previous read did.

-- ─── The home feed ────────────────────────────────────────────────────
--
-- The viewer's posts and those of everyone they follow, newest first, one page.

CREATE OR REPLACE FUNCTION public.feed_posts(
    p_viewer UUID,
    p_before TIMESTAMPTZ DEFAULT NULL,
    p_interest TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT po.*
  FROM public.posts po
  WHERE (po.user_id = p_viewer
         OR po.user_id IN (SELECT f.followed_id FROM public.follows f WHERE f.follower_id = p_viewer))
    AND (p_before IS NULL OR po.created_at < p_before)
    AND (p_interest IS NULL OR po.interest_slug = p_interest)
  ORDER BY po.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 60);
$$;

-- ─── The OneSnap reel ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reel_stories(p_viewer UUID, p_since TIMESTAMPTZ)
RETURNS SETOF public.stories
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.*
  FROM public.stories s
  WHERE (s.user_id = p_viewer
         OR s.user_id IN (SELECT f.followed_id FROM public.follows f WHERE f.follower_id = p_viewer))
    AND s.created_at >= p_since
  ORDER BY s.created_at DESC;
$$;

-- ─── Everyone a profile has messaged ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_partners(p_profile UUID)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.* FROM public.profiles p
  WHERE p.id IN (
    SELECT CASE WHEN m.sender_id = p_profile THEN m.receiver_id ELSE m.sender_id END
    FROM public.messages m
    WHERE m.sender_id = p_profile OR m.receiver_id = p_profile
  );
$$;

-- ─── The profiles of the accounts one account blocked ─────────────────

CREATE OR REPLACE FUNCTION public.blocked_profiles(p_blocker UUID)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.* FROM public.profiles p
  WHERE p.user_id IN (SELECT b.blocked_id FROM public.blocks b WHERE b.blocker_id = p_blocker);
$$;

-- ─── The accounts behind a list of handles ────────────────────────────
--
-- For the one-time move of a device-local block list into the database.

CREATE OR REPLACE FUNCTION public.accounts_for_usernames(p_usernames TEXT[])
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT DISTINCT p.user_id FROM public.profiles p WHERE p.username = ANY (p_usernames);
$$;

-- ─── Suggested profiles ───────────────────────────────────────────────
--
-- The newest profiles the viewer doesn't follow and isn't.

CREATE OR REPLACE FUNCTION public.suggested_profiles(p_viewer UUID, p_limit INTEGER DEFAULT 5)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.* FROM public.profiles p
  WHERE p.id <> p_viewer
    AND p.id NOT IN (SELECT f.followed_id FROM public.follows f WHERE f.follower_id = p_viewer)
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

-- Signed-in only, as every read they replace is.
REVOKE ALL ON FUNCTION public.feed_posts(UUID, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reel_stories(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_partners(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.blocked_profiles(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounts_for_usernames(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.suggested_profiles(UUID, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.feed_posts(UUID, TIMESTAMPTZ, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reel_stories(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_partners(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.blocked_profiles(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounts_for_usernames(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggested_profiles(UUID, INTEGER) TO authenticated;
