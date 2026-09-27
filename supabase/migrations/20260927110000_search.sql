-- Search across all four content types (ONE-48).
--
-- Postgres full-text search, no search service. Products and projects have
-- had a generated tsvector with a GIN index since M5; posts get theirs here.
-- Each type is searched the way that suits it — the mismatch is deliberate,
-- so don't "fix" it:
--
--   * posts, products, projects: full text over their tsvector, ranked with
--     ts_rank. Words match by prefix ("kitch" finds "kitchen"), so results
--     arrive while someone is still typing.
--   * profiles: ILIKE over the handle and the full name, exact-prefix matches
--     first, then alphabetical. A handle is an identifier, not language:
--     stemming "jsmith_builds" or ranking it by term frequency helps nobody.
--
-- Every function is SECURITY INVOKER, so RLS applies to each row, and each
-- also filters explicitly rather than relying on rows silently vanishing:
-- accounts blocked either way never appear (ONE-54), and private projects
-- appear only to their owner and contributors. Signed in only, as Explore is.

-- ─── posts.search_vector ──────────────────────────────────────────────

ALTER TABLE public.posts
    ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english'::regconfig, coalesce(content, ''))
    ) STORED;

CREATE INDEX posts_search_vector ON public.posts USING GIN (search_vector);

-- ─── Building a query from what was typed ─────────────────────────────
--
-- Every word, as a prefix, all required: 'oak deck' → 'oak:* & deck:*'.
-- Anything but letters, digits and spaces is dropped first, so no input can
-- be tsquery syntax. Null when nothing searchable is left.

CREATE OR REPLACE FUNCTION public.search_tsquery(p_query TEXT)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE to_tsquery('english'::regconfig, string_agg(w || ':*', ' & '))
         END
  FROM regexp_split_to_table(
         lower(regexp_replace(coalesce(p_query, ''), '[^[:alnum:][:space:]]+', ' ', 'g')),
         '[[:space:]]+'
       ) AS w
  WHERE w <> '';
$$;

-- Whether one profile's content is hidden from the caller by a block, in
-- either direction. Blocks are account-level; is_blocked_by covers "they
-- blocked me", and the caller can read their own blocks for "I blocked them".
CREATE OR REPLACE FUNCTION public.hidden_by_block(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.is_blocked_by(p_profile_id)
      OR EXISTS (
        SELECT 1 FROM public.blocks b
        JOIN public.profiles p ON p.user_id = b.blocked_id
        WHERE b.blocker_id = (SELECT auth.uid()) AND p.id = p_profile_id
      );
$$;

-- ─── Profiles: prefix match on handle and name ────────────────────────

CREATE OR REPLACE FUNCTION public.search_profiles(p_query TEXT, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN,
    profile_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH q AS (
    -- ILIKE wildcards in what was typed are matched literally.
    SELECT replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') AS term
  )
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.is_verified, p.profile_type
  FROM public.profiles p, q
  WHERE q.term <> ''
    AND (p.username ILIKE '%' || q.term || '%' OR p.full_name ILIKE '%' || q.term || '%')
    AND NOT public.hidden_by_block(p.id)
  ORDER BY
    (p.username ILIKE q.term || '%') DESC,
    (p.full_name ILIKE q.term || '%') DESC,
    lower(p.username)
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- ─── Posts: full text over content ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_posts(p_query TEXT, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    content TEXT,
    image_url TEXT,
    media_type TEXT,
    created_at TIMESTAMPTZ,
    author_username TEXT,
    author_avatar_url TEXT,
    rank REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT po.id, po.content, po.image_url, po.media_type, po.created_at, a.username, a.avatar_url,
         ts_rank(po.search_vector, q.query)
  FROM public.posts po
  JOIN public.profiles a ON a.id = po.user_id,
       (SELECT public.search_tsquery(p_query) AS query) q
  WHERE q.query IS NOT NULL
    AND po.search_vector @@ q.query
    AND NOT public.hidden_by_block(po.user_id)
  ORDER BY ts_rank(po.search_vector, q.query) DESC, po.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- ─── Products: full text over name and description ────────────────────

CREATE OR REPLACE FUNCTION public.search_products(p_query TEXT, p_category TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    name TEXT,
    category TEXT,
    image_url TEXT,
    business_username TEXT,
    business_name TEXT,
    rank REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pd.id, pd.name, pd.category,
         (SELECT m.url FROM public.product_media m
           WHERE m.product_id = pd.id AND m.media_type = 'photo'
           ORDER BY m.sort_order LIMIT 1),
         b.username, coalesce(nullif(b.full_name, ''), b.username),
         ts_rank(pd.search_vector, q.query)
  FROM public.products pd
  JOIN public.profiles b ON b.id = pd.business_profile_id,
       (SELECT public.search_tsquery(p_query) AS query) q
  WHERE q.query IS NOT NULL
    AND pd.search_vector @@ q.query
    AND (p_category IS NULL OR pd.category = p_category)
    AND NOT public.hidden_by_block(pd.business_profile_id)
  ORDER BY ts_rank(pd.search_vector, q.query) DESC, pd.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- ─── Projects: full text over name and description ────────────────────
--
-- A project's category is its project_type.

CREATE OR REPLACE FUNCTION public.search_projects(p_query TEXT, p_category TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    name TEXT,
    project_type TEXT,
    cover_url TEXT,
    owner_username TEXT,
    rank REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pj.id, pj.name, pj.project_type, pj.cover_url, o.username, ts_rank(pj.search_vector, q.query)
  FROM public.projects pj
  JOIN public.profiles o ON o.id = pj.owner_profile_id,
       (SELECT public.search_tsquery(p_query) AS query) q
  WHERE q.query IS NOT NULL
    AND pj.search_vector @@ q.query
    AND (p_category IS NULL OR pj.project_type = p_category)
    AND (pj.is_public OR public.owns_profile(pj.owner_profile_id) OR public.is_project_contributor(pj.id))
    AND NOT public.hidden_by_block(pj.owner_profile_id)
  ORDER BY ts_rank(pj.search_vector, q.query) DESC, pj.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- ─── Who may call them ────────────────────────────────────────────────
--
-- Signed in only, revoked from anon by name (ONE-85). search_tsquery is pure
-- string handling, but nothing signed out needs it either.

REVOKE ALL ON FUNCTION public.search_tsquery(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_tsquery(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.hidden_by_block(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hidden_by_block(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.search_profiles(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.search_posts(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_posts(TEXT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.search_products(TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_products(TEXT, TEXT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.search_projects(TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_projects(TEXT, TEXT, INTEGER) TO authenticated;
