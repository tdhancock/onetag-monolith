-- Interest categories (ONE-49).
--
-- Interests divide content into worlds that barely overlap. The list is fixed
-- and server-defined: a reference table, not free text (which fragments into
-- "Vehicle Builds", "vehicle build", "car builds") and not an enum (adding a
-- category later is a row insert here, not a type alteration).
--
-- Posts and projects take an optional interest. Existing rows keep null — an
-- untagged post is untagged, not miscategorized, so nothing is backfilled —
-- and untagged content appears under "All" only. Products keep their own
-- `category` and take no interest.

CREATE TABLE public.interests (
    slug TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.interests (slug, name, sort_order) VALUES
    ('vehicle-builds', 'Vehicle Builds', 1),
    ('custom-homes', 'Custom Homes', 2),
    ('fitness-and-gear', 'Fitness and Gear', 3),
    ('art-and-installations', 'Art and Installations', 4),
    ('diy-projects', 'DIY Projects', 5),
    ('retail-displays', 'Retail Displays', 6);

-- Readable by anyone; written by migrations only. With RLS on and no write
-- policy, every insert, update and delete through the API is refused.
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Interests are viewable by everyone" ON public.interests
    FOR SELECT TO anon, authenticated USING (true);

-- ─── The interest of a post or a project ──────────────────────────────

ALTER TABLE public.posts ADD COLUMN interest_slug TEXT REFERENCES public.interests(slug);
ALTER TABLE public.projects ADD COLUMN interest_slug TEXT REFERENCES public.interests(slug);

-- Every filtered feed and Explore page reads these, newest first.
CREATE INDEX posts_interest_slug_created_at ON public.posts (interest_slug, created_at DESC);
CREATE INDEX projects_interest_slug_created_at ON public.projects (interest_slug, created_at DESC);

-- ─── explore_items, filterable by interest ────────────────────────────
--
-- As ONE-47 left it, plus p_interest: null for "All"; a slug narrows the
-- grid to posts and projects with that interest, in the query itself, so a
-- filtered page is still full-length. Products carry no interest, so a
-- filtered grid has none.
--
-- The signature changes, so the old function is dropped and the new one's
-- grants stated.

DROP FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER);

CREATE FUNCTION public.explore_items(
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
  WITH visible_owner AS (
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
      AND (p_interest IS NULL OR po.interest_slug = p_interest)

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
    WHERE p_interest IS NULL

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
      AND (p_interest IS NULL OR pj.interest_slug = p_interest)
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

REVOKE ALL ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explore_items(DOUBLE PRECISION, TEXT, INTEGER, TEXT) TO authenticated;
