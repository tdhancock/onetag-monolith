-- What hangs off a post is as private as the post (ONE-109).
--
-- A private account's posts were hidden from non-followers (ONE-58), but
-- their comments, likes and reposts were readable by anyone signed in:
-- `USING (true)`. A stranger could read the comment threads under posts they
-- couldn't see, and who liked them. Comment likes and OneSnap likes were the
-- same, and so were Explore's stored counts (ONE-104).
--
-- Now each is readable when its parent is. A comment, like or repost is
-- readable when its post is, a comment like when its comment is, a OneSnap
-- like when its OneSnap is, and an Explore score when its item is. The
-- parent's own policy decides, privacy and blocks included (ONE-108). A
-- comment, like or repost by someone across a block is hidden too.
--
-- Post cards stop counting rows for their like, comment and repost figures.
-- Under these policies every counted row would check its post again, so they
-- read the totals explore_scores keeps (services/postRows.ts).

DROP POLICY "Comments are viewable" ON public.comments;
CREATE POLICY "Comments visible with their post" ON public.comments
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id)
        AND user_id NOT IN (SELECT public.hidden_profile_ids())
    );

DROP POLICY "Likes are viewable" ON public.likes;
CREATE POLICY "Likes visible with their post" ON public.likes
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.posts p WHERE p.id = likes.post_id)
        AND user_id NOT IN (SELECT public.hidden_profile_ids())
    );

DROP POLICY "Reposts are viewable" ON public.reposts;
CREATE POLICY "Reposts visible with their post" ON public.reposts
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.posts p WHERE p.id = reposts.post_id)
        AND user_id NOT IN (SELECT public.hidden_profile_ids())
    );

DROP POLICY "Comment likes are viewable" ON public.comment_likes;
CREATE POLICY "Comment likes visible with their comment" ON public.comment_likes
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_likes.comment_id));

DROP POLICY "Story likes are viewable" ON public.story_likes;
CREATE POLICY "Story likes visible with their OneSnap" ON public.story_likes
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_likes.story_id));

-- Explore's stored counts: readable when the item is. A product is always
-- readable, so it needs no check.
--
-- The post check is inline, so a query reading many scores (a feed's post
-- cards) computes the block set once for the whole statement. The project
-- check is a function. Inline, the planner flattened it into a scan of every
-- project, running the projects policy's per-row contributor check on each.
-- As plpgsql it can't be flattened, and runs only for project rows actually
-- read, still as the caller.
CREATE OR REPLACE FUNCTION public.explore_project_visible(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.projects pj WHERE pj.id = p_project_id);
END;
$$;

REVOKE ALL ON FUNCTION public.explore_project_visible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explore_project_visible(UUID) TO authenticated;

DROP POLICY "Signed-in users can read explore scores" ON public.explore_scores;
CREATE POLICY "Explore scores visible with their item" ON public.explore_scores
    FOR SELECT TO authenticated
    USING (
        (post_id IS NULL OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = explore_scores.post_id))
        AND (project_id IS NULL OR public.explore_project_visible(project_id))
    );

-- explore_items, with each item read by id. The policy above lowered the
-- planner's estimate of how many scores a page reads. It then read products
-- and projects in full for every page row (228,000 rows thrown away at the
-- ONE-95 100x volume, and the projects policy checked on each) instead of
-- looking up the 24 it needed. A LIMIT 1 lateral can't be flattened into a
-- join, so each stays an index lookup whatever the estimate. Otherwise
-- unchanged: the same rules, rows, scores and cursor (explore_scores.test.sql).
CREATE OR REPLACE FUNCTION public.explore_items(
    p_after_score DOUBLE PRECISION DEFAULT NULL,
    p_after_key TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 24,
    p_interest TEXT DEFAULT NULL
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
  WITH page AS MATERIALIZED (
    SELECT
      es.kind,
      es.item_key,
      es.score,
      es.created_at,
      coalesce(es.post_id, es.product_id, es.project_id) AS id,
      o.id AS owner_profile_id,
      o.username AS owner_username,
      CASE es.kind WHEN 'post' THEN po.content WHEN 'product' THEN pd.name ELSE pj.name END AS title,
      CASE es.kind WHEN 'post' THEN po.image_url WHEN 'project' THEN pj.cover_url END AS image_url,
      CASE es.kind WHEN 'post' THEN po.media_type ELSE 'image' END AS media_type
    FROM public.explore_scores es
    LEFT JOIN LATERAL (
      SELECT x.user_id, x.content, x.image_url, x.media_type, x.id
      FROM public.posts x WHERE x.id = es.post_id LIMIT 1
    ) po ON true
    LEFT JOIN LATERAL (
      SELECT x.business_profile_id, x.name, x.id
      FROM public.products x WHERE x.id = es.product_id LIMIT 1
    ) pd ON true
    LEFT JOIN LATERAL (
      SELECT x.owner_profile_id, x.name, x.cover_url, x.is_public, x.id
      FROM public.projects x WHERE x.id = es.project_id LIMIT 1
    ) pj ON true
    JOIN public.profiles o ON o.id = coalesce(po.user_id, pd.business_profile_id, pj.owner_profile_id)
    WHERE es.created_at > now() - interval '90 days'
      AND (p_after_score IS NULL OR (es.score, es.item_key) < (p_after_score, p_after_key))
      -- A product has no interest, so a filtered grid has none.
      AND (p_interest IS NULL OR es.interest_slug = p_interest)
      AND CASE es.kind
            WHEN 'post' THEN po.id IS NOT NULL AND NOT o.is_private
            WHEN 'product' THEN pd.id IS NOT NULL
            ELSE pj.id IS NOT NULL AND pj.is_public
          END
      -- Not the caller's own account: owns_profile(o.id), row by row.
      AND o.user_id IS DISTINCT FROM (SELECT auth.uid())
      AND NOT public.is_blocked_by(o.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = o.user_id
      )
    ORDER BY es.score DESC, es.item_key DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  SELECT
    p.kind,
    p.id,
    p.item_key,
    p.owner_profile_id,
    p.owner_username,
    p.title,
    CASE p.kind
      WHEN 'product' THEN (SELECT m.url FROM public.product_media m
                           WHERE m.product_id = p.id AND m.media_type = 'photo'
                           ORDER BY m.sort_order LIMIT 1)
      ELSE p.image_url
    END,
    p.media_type,
    CASE p.kind
      WHEN 'post' THEN (SELECT count(*)::INT FROM public.tags t
                        WHERE t.host_post_id = p.id AND t.tag_type = 'embedded' AND t.active)
      ELSE 0
    END,
    p.created_at,
    p.score
  FROM page p
  ORDER BY p.score DESC, p.item_key DESC;
$$;

-- A post card now embeds its row, so a query anon may run on posts must be
-- able to name the table. The policy is for signed-in users only, so anon
-- still reads nothing.
GRANT SELECT ON public.explore_scores TO anon;
