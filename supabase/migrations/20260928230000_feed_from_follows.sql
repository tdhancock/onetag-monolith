-- The home feed starts from the people you follow (ONE-116).
--
-- feed_posts walked every post, newest first, testing each against the
-- viewer's follows until it had a page. That's quick when the follows post
-- often. When they rarely post, or there are none, it covered nearly every
-- post on the platform looking for 20 it never found: at 666,740 posts, a new
-- account following nobody timed out, and so did one whose three follows had
-- gone quiet.
--
-- Now feed_candidates() chooses the page from the follow list:
--   1. each followed account's newest post before the cursor, and the
--      viewer's own: one step down an index each;
--   2. the page-length of accounts whose newest posts are newest. No other
--      account can have a post on the page: these accounts alone already
--      have that many posts newer than anything it has.
--   3. those accounts' newest posts, merged: a page of them.
-- The work grows with how many accounts the viewer follows, not with how many
-- posts exist. It returns exactly what the walk returned, ties included
-- (feed_parity.test.sql). Through the API, at 666,740 posts:
--   following nobody: timed out → 4 ms;  3 quiet accounts: timed out → 5 ms;
--   3 active: 19 → 5 ms;  300: 8 → 7 ms;  3,000: 5 → 21 ms.
--
-- It runs as the database. The same steps under RLS re-ran the posts policy
-- for every followed account: 671 ms at 300 follows. It only chooses ids, and
-- only for a profile the caller owns; feed_posts reads the page under the
-- caller's RLS as before. The accounts it reads are the viewer's own follows,
-- whose posts RLS shows a follower, so that read loses nothing.
--
-- A new index serves each account's posts newest first, ids included, so the
-- steps above read the index alone: 75 and 570 ms without it, at 300 and
-- 3,000 follows. It replaces idx_posts_user_created, whose reads (the
-- profile grid) it serves as well.

CREATE INDEX idx_posts_user_feed ON public.posts (user_id, created_at DESC, id DESC) INCLUDE (interest_slug);
DROP INDEX public.idx_posts_user_created;

CREATE OR REPLACE FUNCTION public.feed_candidates(
    p_viewer UUID,
    p_before TIMESTAMPTZ,
    p_before_id UUID,
    p_interest TEXT,
    p_limit INTEGER
)
RETURNS TABLE (id UUID, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH authors AS (
    SELECT p_viewer AS author
    WHERE (SELECT public.owns_profile(p_viewer))
    UNION
    SELECT f.followed_id FROM public.follows f
    WHERE f.follower_id = p_viewer AND (SELECT public.owns_profile(p_viewer))
  ),
  newest AS (
    SELECT a.author, n.created_at, n.id
    FROM authors a
    CROSS JOIN LATERAL (
      SELECT po.created_at, po.id FROM public.posts po
      WHERE po.user_id = a.author
        AND po.created_at <= CASE WHEN p_before IS NULL THEN 'infinity'::timestamptz ELSE p_before END
        AND (p_before IS NULL OR (po.created_at, po.id) < (p_before, p_before_id))
        AND (p_interest IS NULL OR po.interest_slug = p_interest)
      ORDER BY po.created_at DESC, po.id DESC
      LIMIT 1
    ) n
  ),
  leading_authors AS (
    SELECT author FROM newest
    ORDER BY created_at DESC, id DESC
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 60)
  )
  SELECT c.id, c.created_at
  FROM leading_authors l
  CROSS JOIN LATERAL (
    SELECT po.id, po.created_at FROM public.posts po
    WHERE po.user_id = l.author
      AND po.created_at <= CASE WHEN p_before IS NULL THEN 'infinity'::timestamptz ELSE p_before END
      AND (p_before IS NULL OR (po.created_at, po.id) < (p_before, p_before_id))
      AND (p_interest IS NULL OR po.interest_slug = p_interest)
    ORDER BY po.created_at DESC, po.id DESC
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 60)
  ) c
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 60);
$$;

REVOKE ALL ON FUNCTION public.feed_candidates(UUID, TIMESTAMPTZ, UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_candidates(UUID, TIMESTAMPTZ, UUID, TEXT, INTEGER) TO authenticated;

-- Same signature, grants and results as ONE-113's; the page now comes from
-- feed_candidates(), read under the caller's RLS.
CREATE OR REPLACE FUNCTION public.feed_posts(
    p_viewer UUID,
    p_before TIMESTAMPTZ DEFAULT NULL,
    p_interest TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_before_id UUID DEFAULT NULL
)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT po.*
  FROM public.posts po
  WHERE po.id IN (SELECT c.id FROM public.feed_candidates(p_viewer, p_before, p_before_id, p_interest, p_limit) c)
  ORDER BY po.created_at DESC, po.id DESC;
$$;
