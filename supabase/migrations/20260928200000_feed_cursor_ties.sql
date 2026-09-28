-- The feed pages by (created_at, id), not created_at alone (ONE-113).
--
-- feed_posts returned what came strictly before the last post's time, so two
-- posts sharing a created_at either side of a page boundary lost the second:
-- the next page began before their shared time. It takes a clash to the
-- microsecond — an import, a seed, two devices — but nothing prevented it.
--
-- Now the cursor is the last post's time and id, ties are ordered by id, and
-- the next page starts right after that post, as Explore's does by
-- (score, item_key). p_before_id comes last and is optional: given only a
-- time, the function still returns what came before that time, since the row
-- comparison is unknown at that time exactly.
--
-- The time bound is also stated on its own, which the function's plan can
-- use as an index condition, so the scan starts at the cursor. As
-- `p_before IS NULL OR …` it was only a filter, and a page 40,000 posts into a
-- feed walked every newer post first: 207 ms, now 4 ms. It is a CASE, not
-- coalesce(): under RLS only a leakproof condition may run ahead of the
-- policy, as an index condition does, and Postgres counts CASE as leakproof
-- but not coalesce().

DROP FUNCTION public.feed_posts(UUID, TIMESTAMPTZ, TEXT, INTEGER);

CREATE FUNCTION public.feed_posts(
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
  WHERE (po.user_id = p_viewer
         OR po.user_id IN (SELECT f.followed_id FROM public.follows f WHERE f.follower_id = p_viewer))
    AND po.created_at <= CASE WHEN p_before IS NULL THEN 'infinity'::timestamptz ELSE p_before END
    AND (p_before IS NULL OR (po.created_at, po.id) < (p_before, p_before_id))
    AND (p_interest IS NULL OR po.interest_slug = p_interest)
  ORDER BY po.created_at DESC, po.id DESC
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 60);
$$;

REVOKE ALL ON FUNCTION public.feed_posts(UUID, TIMESTAMPTZ, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_posts(UUID, TIMESTAMPTZ, TEXT, INTEGER, UUID) TO authenticated;
