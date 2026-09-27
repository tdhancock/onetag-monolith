-- Explore: the discovery grid (ONE-47).
--
-- One ordered, paginated list mixing posts, products and projects. The three
-- live in three tables, and the order depends on counts (likes, saves), so no
-- PostgREST select can express it; this function does, in one query.
--
-- ─── The ordering, stated so it can be reasoned about ─────────────────
--
--   score = hours since 1970 at creation + 24 × log2(1 + engagement)
--
-- Recency is the base, and each doubling of engagement is worth one day of
-- recency: a post with 7 engagements ranks like an unengaged post made three
-- days later. Nothing is precomputed and nothing runs on a schedule — no
-- trending scores, no recommendation engine (ONE-47, requirement 3).
-- Engagement is likes + comments + reposts + saves for a post, and saves for
-- a product or a project.
--
-- ─── What never appears ───────────────────────────────────────────────
--
--   * the viewer's own content: anything owned by a profile their account owns;
--   * anyone blocked, either way: an account the viewer blocked, or one that
--     blocked the viewer (ONE-54);
--   * private content, filtered here explicitly rather than left to RLS, so a
--     hidden item never takes a slot: private projects, and posts by private
--     profiles — Explore is for discovery, and a private account's posts are
--     for its followers' feeds.
--
-- SECURITY INVOKER: RLS still applies to every row read, on top of the
-- explicit filters. Signed in only, as the Explore tab is.
--
-- Paging is keyset on (score, kind, id), strictly after the last row of the
-- previous page. Engagement moves between pages, so the client dedupes by
-- kind and id as well; a keyset never repeats a row within one score anyway.

CREATE OR REPLACE FUNCTION public.explore_items(
    p_after_score DOUBLE PRECISION DEFAULT NULL,
    p_after_key TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 24
)
RETURNS TABLE (
    kind TEXT,
    id UUID,
    item_key TEXT,
    owner_profile_id UUID,
    owner_username TEXT,
    title TEXT,
    image_url TEXT,
    media_type TEXT,
    tag_count INTEGER,
    created_at TIMESTAMPTZ,
    score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH visible_owner AS (
    -- Profiles whose content may appear: not the viewer's, not blocked
    -- either way. Account-level blocks, through each profile's user_id.
    SELECT p.id, p.username, p.is_private
    FROM public.profiles p
    WHERE NOT public.owns_profile(p.id)
      AND NOT public.is_blocked_by(p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = p.user_id
      )
  ),
  items AS (
    SELECT
      'post'::TEXT AS kind,
      po.id,
      o.id AS owner_profile_id,
      o.username AS owner_username,
      po.content AS title,
      po.image_url,
      po.media_type,
      (SELECT count(*)::INT FROM public.tags t
        WHERE t.host_post_id = po.id AND t.tag_type = 'embedded' AND t.active) AS tag_count,
      po.created_at,
      (SELECT count(*) FROM public.likes l WHERE l.post_id = po.id)
        + (SELECT count(*) FROM public.comments c WHERE c.post_id = po.id)
        + (SELECT count(*) FROM public.reposts r WHERE r.post_id = po.id)
        + (SELECT count(*) FROM public.saves s WHERE s.saved_post_id = po.id) AS engagement
    FROM public.posts po
    JOIN visible_owner o ON o.id = po.user_id
    WHERE NOT o.is_private

    UNION ALL

    SELECT
      'product',
      pd.id,
      o.id,
      o.username,
      pd.name,
      (SELECT m.url FROM public.product_media m
        WHERE m.product_id = pd.id AND m.media_type = 'photo'
        ORDER BY m.sort_order LIMIT 1),
      'image',
      0,
      pd.created_at,
      (SELECT count(*) FROM public.saves s WHERE s.saved_product_id = pd.id)
    FROM public.products pd
    JOIN visible_owner o ON o.id = pd.business_profile_id

    UNION ALL

    SELECT
      'project',
      pj.id,
      o.id,
      o.username,
      pj.name,
      pj.cover_url,
      'image',
      0,
      pj.created_at,
      (SELECT count(*) FROM public.saves s WHERE s.saved_project_id = pj.id)
    FROM public.projects pj
    JOIN visible_owner o ON o.id = pj.owner_profile_id
    WHERE pj.is_public
  ),
  scored AS (
    SELECT
      i.*,
      i.kind || ':' || i.id::TEXT AS item_key,
      extract(epoch FROM i.created_at) / 3600.0 + 24 * log(2, 1 + i.engagement::NUMERIC)::DOUBLE PRECISION AS score
    FROM items i
  )
  SELECT kind, id, item_key, owner_profile_id, owner_username, title, image_url, media_type, tag_count, created_at, score
  FROM scored
  WHERE p_after_score IS NULL
     OR (score, item_key) < (p_after_score, p_after_key)
  ORDER BY score DESC, item_key DESC
  LIMIT least(greatest(coalesce(p_limit, 24), 1), 60);
$$;

-- Signed in only. Revoked from anon by name: Supabase's default privileges
-- grant new functions to anon directly (ONE-85).
REVOKE ALL ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER) TO authenticated;
