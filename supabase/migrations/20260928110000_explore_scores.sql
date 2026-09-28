-- Explore reads stored scores (ONE-104), and counts everyone's saves (ONE-101).
--
-- explore_items scored every post, product and project in its 90-day window
-- on every page, with four correlated counts per post, then sorted them all.
-- At 50k posts in the window a page took 4–6 s (ONE-95). And because saves
-- are private under RLS and the function runs as the caller, its saves term
-- only ever counted the viewer's own saves (ONE-101).
--
-- The score, epoch/3600 + 24·log2(1 + engagement), has no now() term: it
-- changes only when engagement does. So each item's counts and score are
-- kept here, maintained by triggers on the engagement tables, and a page is
-- an index scan that stops once it is full.
--
-- The triggers are SECURITY DEFINER, so every save counts. The table holds
-- totals only: never who liked or saved. Signed-in users can read it; nobody
-- writes it but the triggers.
--
-- explore_items keeps its signature, its cursor and every visibility rule,
-- so the client is unchanged. supabase/tests/explore_scores.test.sql pins
-- that it returns exactly what the previous function did, apart from the
-- saves fix.

-- ─── The table ────────────────────────────────────────────────────────

CREATE TABLE public.explore_scores (
    item_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('post', 'product', 'project')),
    post_id UUID UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
    product_id UUID UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
    project_id UUID UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
    -- The item's own, copied so the window and the score need no join.
    created_at TIMESTAMPTZ NOT NULL,
    interest_slug TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    reposts INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    score DOUBLE PRECISION NOT NULL,
    CONSTRAINT explore_scores_one_item CHECK (num_nonnulls(post_id, product_id, project_id) = 1)
);

-- The grid's order, and its order within one interest.
CREATE INDEX explore_scores_rank ON public.explore_scores (score DESC, item_key DESC);
CREATE INDEX explore_scores_interest_rank ON public.explore_scores (interest_slug, score DESC, item_key DESC)
    WHERE interest_slug IS NOT NULL;

ALTER TABLE public.explore_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read explore scores" ON public.explore_scores
    FOR SELECT TO authenticated USING (true);
-- No write policies, and no write privileges either, so a direct write is
-- refused outright rather than filtered to nothing. Only the triggers below,
-- as definer, write it.
REVOKE ALL ON public.explore_scores FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.explore_scores FROM authenticated;

-- ─── The score ────────────────────────────────────────────────────────
--
-- Exactly the expression explore_items used, so orderings and the cursors
-- clients already hold compare the same way.

CREATE OR REPLACE FUNCTION public.explore_scores_set_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.score := extract(epoch FROM NEW.created_at) / 3600.0
    + 24 * log(2, 1 + (NEW.likes + NEW.comments + NEW.reposts + NEW.saves)::NUMERIC)::DOUBLE PRECISION;
  RETURN NEW;
END;
$$;

CREATE TRIGGER explore_scores_score
    BEFORE INSERT OR UPDATE ON public.explore_scores
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_set_score();

-- ─── Items join and leave ─────────────────────────────────────────────
--
-- A new post, product or project gets its row. Deleting one cascades.

CREATE OR REPLACE FUNCTION public.explore_scores_add_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    INSERT INTO public.explore_scores (item_key, kind, post_id, created_at, interest_slug, score)
    VALUES ('post:' || NEW.id, 'post', NEW.id, NEW.created_at, NEW.interest_slug, 0);
  ELSIF TG_TABLE_NAME = 'products' THEN
    INSERT INTO public.explore_scores (item_key, kind, product_id, created_at, score)
    VALUES ('product:' || NEW.id, 'product', NEW.id, NEW.created_at, 0);
  ELSE
    INSERT INTO public.explore_scores (item_key, kind, project_id, created_at, interest_slug, score)
    VALUES ('project:' || NEW.id, 'project', NEW.id, NEW.created_at, NEW.interest_slug, 0);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER posts_explore_scores AFTER INSERT ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_add_item();
CREATE TRIGGER products_explore_scores AFTER INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_add_item();
CREATE TRIGGER projects_explore_scores AFTER INSERT ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_add_item();

-- A post's or project's interest, or a date, can change after it is made.
CREATE OR REPLACE FUNCTION public.explore_scores_sync_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.explore_scores
  SET created_at = NEW.created_at, interest_slug = NEW.interest_slug
  WHERE item_key = (CASE WHEN TG_TABLE_NAME = 'posts' THEN 'post:' ELSE 'project:' END) || NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER posts_explore_scores_sync AFTER UPDATE OF created_at, interest_slug ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_sync_item();
CREATE TRIGGER projects_explore_scores_sync AFTER UPDATE OF created_at, interest_slug ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_sync_item();

-- ─── Engagement moves the counts ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.explore_scores_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r RECORD;
  d INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; d := -1; ELSE r := NEW; d := 1; END IF;

  IF TG_TABLE_NAME = 'likes' THEN
    UPDATE public.explore_scores SET likes = greatest(likes + d, 0) WHERE post_id = r.post_id;
  ELSIF TG_TABLE_NAME = 'comments' THEN
    UPDATE public.explore_scores SET comments = greatest(comments + d, 0) WHERE post_id = r.post_id;
  ELSIF TG_TABLE_NAME = 'reposts' THEN
    UPDATE public.explore_scores SET reposts = greatest(reposts + d, 0) WHERE post_id = r.post_id;
  ELSIF r.saved_post_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0) WHERE post_id = r.saved_post_id;
  ELSIF r.saved_product_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0) WHERE product_id = r.saved_product_id;
  ELSIF r.saved_project_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0) WHERE project_id = r.saved_project_id;
  END IF;
  -- A saved profile isn't in Explore; nothing to move.
  RETURN NULL;
END;
$$;

CREATE TRIGGER likes_explore_scores AFTER INSERT OR DELETE ON public.likes
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_count();
CREATE TRIGGER comments_explore_scores AFTER INSERT OR DELETE ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_count();
CREATE TRIGGER reposts_explore_scores AFTER INSERT OR DELETE ON public.reposts
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_count();
CREATE TRIGGER saves_explore_scores AFTER INSERT OR DELETE ON public.saves
    FOR EACH ROW EXECUTE FUNCTION public.explore_scores_count();

-- ─── Rebuilding from scratch ──────────────────────────────────────────
--
-- The backfill below, and a repair tool if the counts are ever doubted.
-- Nobody but the database owner calls it.
--
-- Nested-loop joins are off for its run. It joins every post to grouped
-- counts, where a hash join is always right. Without fresh statistics (right
-- after a bulk load, say) the planner guessed a handful of groups, chose a
-- nested loop, and re-aggregated a million likes per post: minutes, not
-- seconds. The setting makes it independent of statistics.

CREATE OR REPLACE FUNCTION public.rebuild_explore_scores()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET enable_nestloop = off
AS $$
  DELETE FROM public.explore_scores;

  INSERT INTO public.explore_scores (item_key, kind, post_id, created_at, interest_slug, likes, comments, reposts, saves, score)
  SELECT 'post:' || po.id, 'post', po.id, po.created_at, po.interest_slug,
         coalesce(l.n, 0), coalesce(c.n, 0), coalesce(r.n, 0), coalesce(s.n, 0), 0
  FROM public.posts po
  LEFT JOIN (SELECT post_id, count(*)::INT AS n FROM public.likes GROUP BY post_id) l ON l.post_id = po.id
  LEFT JOIN (SELECT post_id, count(*)::INT AS n FROM public.comments GROUP BY post_id) c ON c.post_id = po.id
  LEFT JOIN (SELECT post_id, count(*)::INT AS n FROM public.reposts GROUP BY post_id) r ON r.post_id = po.id
  LEFT JOIN (SELECT saved_post_id, count(*)::INT AS n FROM public.saves
             WHERE saved_post_id IS NOT NULL GROUP BY saved_post_id) s ON s.saved_post_id = po.id;

  INSERT INTO public.explore_scores (item_key, kind, product_id, created_at, saves, score)
  SELECT 'product:' || pd.id, 'product', pd.id, pd.created_at, coalesce(s.n, 0), 0
  FROM public.products pd
  LEFT JOIN (SELECT saved_product_id, count(*)::INT AS n FROM public.saves
             WHERE saved_product_id IS NOT NULL GROUP BY saved_product_id) s ON s.saved_product_id = pd.id;

  INSERT INTO public.explore_scores (item_key, kind, project_id, created_at, interest_slug, saves, score)
  SELECT 'project:' || pj.id, 'project', pj.id, pj.created_at, pj.interest_slug, coalesce(s.n, 0), 0
  FROM public.projects pj
  LEFT JOIN (SELECT saved_project_id, count(*)::INT AS n FROM public.saves
             WHERE saved_project_id IS NOT NULL GROUP BY saved_project_id) s ON s.saved_project_id = pj.id;
$$;

REVOKE ALL ON FUNCTION public.rebuild_explore_scores() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.explore_scores_add_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.explore_scores_sync_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.explore_scores_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.explore_scores_set_score() FROM PUBLIC, anon, authenticated;

SELECT public.rebuild_explore_scores();

-- ─── explore_items, reading the stored scores ─────────────────────────
--
-- The same rules as ONE-47 and ONE-49 left them:
--   - nothing of the caller's own account;
--   - nothing across a block, either way;
--   - no post of a private profile; no private project;
--   - only the last 90 days;
--   - p_interest narrows to posts and projects with that interest.
-- The page is chosen from the index first; titles, images and tag counts are
-- read for its rows only.

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
    LEFT JOIN public.posts po ON po.id = es.post_id
    LEFT JOIN public.products pd ON pd.id = es.product_id
    LEFT JOIN public.projects pj ON pj.id = es.project_id
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

REVOKE ALL ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER, TEXT) TO authenticated;
