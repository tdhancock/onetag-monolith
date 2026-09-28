-- explore_items reads stored scores (ONE-104), and counts everyone's saves
-- (ONE-101). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- The previous explore_items is kept below, verbatim, as pg_temp.explore_reference.
-- Run as the table owner, RLS doesn't apply to it, so its saves term counts
-- every save: that is the old function with ONE-101 fixed, and nothing else
-- changed. The new function, run as the viewer, must return exactly what it
-- returns: the same items, the same scores, in the same order, page by page.
--
-- V: the viewer, with a post of its own. A, C: individuals with posts, one on
-- an interest, one ancient. B: a business with products and projects, public
-- and private. P: private. X blocked V; V blocked Y. Thirty fans supply the
-- engagement, and their saves are what ONE-101 was about.

BEGIN;
SELECT plan(19);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000104a0', 'v@one104.test', '{"username":"one104_v"}'),
  ('00000000-0000-0000-0000-0000000104a1', 'a@one104.test', '{"username":"one104_a"}'),
  ('00000000-0000-0000-0000-0000000104a2', 'b@one104.test', '{"username":"one104_b"}'),
  ('00000000-0000-0000-0000-0000000104a3', 'c@one104.test', '{"username":"one104_c"}'),
  ('00000000-0000-0000-0000-0000000104a4', 'p@one104.test', '{"username":"one104_p"}'),
  ('00000000-0000-0000-0000-0000000104a5', 'x@one104.test', '{"username":"one104_x"}'),
  ('00000000-0000-0000-0000-0000000104a6', 'y@one104.test', '{"username":"one104_y"}');
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('00000000-0000-0000-0000-000000104f' || lpad(g::text, 2, '0'))::uuid,
       'f' || g || '@one104.test', jsonb_build_object('username', 'one104_f' || g)
FROM generate_series(1, 30) g;

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('00000000-0000-0000-0000-0000000104a2', 'business', 'one104_b_biz', 'B Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one104_b_biz';
UPDATE public.profiles SET is_private = true WHERE username = 'one104_p';
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000104a5', '00000000-0000-0000-0000-0000000104a0'),
  ('00000000-0000-0000-0000-0000000104a0', '00000000-0000-0000-0000-0000000104a6');

CREATE TEMP TABLE fans ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY username) AS n, id FROM public.profiles WHERE username LIKE 'one104_f%';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one104_v') AS v,
  (SELECT id FROM public.profiles WHERE username = 'one104_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one104_b_biz') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one104_c') AS c,
  (SELECT id FROM public.profiles WHERE username = 'one104_p') AS p,
  (SELECT id FROM public.profiles WHERE username = 'one104_x') AS x,
  (SELECT id FROM public.profiles WHERE username = 'one104_y') AS y;
GRANT SELECT ON ids, fans TO authenticated;

-- Twelve posts at staggered ages, most of them A's and C's.
INSERT INTO public.posts (id, user_id, content, image_url, media_type, created_at, interest_slug)
SELECT ('10400000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       CASE WHEN g % 2 = 0 THEN (SELECT a FROM ids) ELSE (SELECT c FROM ids) END,
       'post ' || g, 'p' || g || '.jpg', CASE WHEN g % 3 = 0 THEN 'text' ELSE 'image' END,
       now() - (g * interval '7 hours'),
       CASE WHEN g % 4 = 0 THEN 'diy-projects' END
FROM generate_series(1, 12) g;
INSERT INTO public.posts (id, user_id, content, media_type, created_at) VALUES
  ('10400000-0000-0000-0000-0000000000f1', (SELECT v FROM ids), 'mine', 'text', now()),
  ('10400000-0000-0000-0000-0000000000f2', (SELECT p FROM ids), 'secret', 'text', now()),
  ('10400000-0000-0000-0000-0000000000f3', (SELECT x FROM ids), 'fromx', 'text', now()),
  ('10400000-0000-0000-0000-0000000000f4', (SELECT y FROM ids), 'fromy', 'text', now()),
  ('10400000-0000-0000-0000-0000000000f5', (SELECT a FROM ids), 'ancient', 'text', now() - interval '100 days');

INSERT INTO public.products (id, business_profile_id, name, created_at) VALUES
  ('10400000-0000-0000-0000-0000000000a1', (SELECT bb FROM ids), 'Lamp', now() - interval '3 hours'),
  ('10400000-0000-0000-0000-0000000000a2', (SELECT bb FROM ids), 'Chair', now() - interval '30 hours');
INSERT INTO public.product_media (product_id, url, media_type, sort_order) VALUES
  ('10400000-0000-0000-0000-0000000000a1', 'lamp-2.jpg', 'photo', 2),
  ('10400000-0000-0000-0000-0000000000a1', 'lamp-1.jpg', 'photo', 1);
INSERT INTO public.projects (id, owner_profile_id, name, is_public, cover_url, created_at, interest_slug) VALUES
  ('10400000-0000-0000-0000-0000000000b1', (SELECT bb FROM ids), 'Loft', true, 'loft.jpg', now() - interval '5 hours', 'diy-projects'),
  ('10400000-0000-0000-0000-0000000000b2', (SELECT bb FROM ids), 'Vault', false, 'vault.jpg', now(), NULL),
  ('10400000-0000-0000-0000-0000000000b3', (SELECT bb FROM ids), 'Deck', true, 'deck.jpg', now() - interval '50 hours', NULL);

-- Engagement: post g gets (g * 7) % 30 likes, g % 4 comments, g % 3 reposts
-- and g % 5 saves, from the fans. Products and projects get fans' saves.
INSERT INTO public.likes (post_id, user_id)
SELECT po.id, f.id FROM public.posts po JOIN fans f ON f.n <= (substr(po.content, 6)::int * 7) % 30
WHERE po.content LIKE 'post %';
INSERT INTO public.comments (post_id, user_id, content)
SELECT po.id, f.id, 'nice' FROM public.posts po JOIN fans f ON f.n <= substr(po.content, 6)::int % 4
WHERE po.content LIKE 'post %';
INSERT INTO public.reposts (post_id, user_id)
SELECT po.id, f.id FROM public.posts po JOIN fans f ON f.n <= substr(po.content, 6)::int % 3
WHERE po.content LIKE 'post %';
INSERT INTO public.saves (profile_id, saved_post_id)
SELECT f.id, po.id FROM public.posts po JOIN fans f ON f.n <= substr(po.content, 6)::int % 5
WHERE po.content LIKE 'post %';
INSERT INTO public.saves (profile_id, saved_product_id)
SELECT f.id, '10400000-0000-0000-0000-0000000000a2' FROM fans f WHERE f.n <= 9;
INSERT INTO public.saves (profile_id, saved_project_id)
SELECT f.id, '10400000-0000-0000-0000-0000000000b3' FROM fans f WHERE f.n <= 4;
-- One of the viewer's own saves, which the old function could see.
INSERT INTO public.saves (profile_id, saved_product_id) SELECT v, '10400000-0000-0000-0000-0000000000a1' FROM ids;

-- The previous explore_items, verbatim (20260927120000_interests.sql).
CREATE FUNCTION pg_temp.explore_reference(
    p_after_score DOUBLE PRECISION DEFAULT NULL,
    p_after_key TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 24,
    p_interest TEXT DEFAULT NULL
)
RETURNS TABLE (
    kind TEXT, id UUID, item_key TEXT, owner_profile_id UUID, owner_username TEXT, title TEXT,
    image_url TEXT, media_type TEXT, tag_count INTEGER, created_at TIMESTAMPTZ, score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
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
    WHERE po.created_at > now() - interval '90 days'
      AND NOT o.is_private
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
    WHERE pd.created_at > now() - interval '90 days'
      AND p_interest IS NULL

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
    WHERE pj.created_at > now() - interval '90 days'
      AND pj.is_public
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

-- Every page of the new function, walked by its cursor, as one list.
CREATE FUNCTION pg_temp.walk(p_page INTEGER, p_interest TEXT DEFAULT NULL)
RETURNS TABLE (n INTEGER, item_key TEXT, score DOUBLE PRECISION, row_text TEXT)
LANGUAGE plpgsql
AS $fn$
DECLARE
  s DOUBLE PRECISION := NULL;
  k TEXT := NULL;
  i INTEGER := 0;
  r RECORD;
  got INTEGER;
BEGIN
  LOOP
    got := 0;
    FOR r IN SELECT * FROM public.explore_items(s, k, p_page, p_interest) LOOP
      i := i + 1; got := got + 1;
      n := i; item_key := r.item_key; score := r.score; row_text := r::TEXT;
      s := r.score; k := r.item_key;
      RETURN NEXT;
    END LOOP;
    EXIT WHEN got < p_page;
  END LOOP;
END;
$fn$;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000104a0","role":"authenticated"}', true);

-- The expected grids, as the table owner: RLS doesn't apply, so every save counts.
CREATE TEMP TABLE expected ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY score DESC, item_key DESC)::INT AS n, r.item_key, r.score, r::TEXT AS row_text
FROM pg_temp.explore_reference(NULL, NULL, 60) r;
CREATE TEMP TABLE expected_diy ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY score DESC, item_key DESC)::INT AS n, r.item_key, r.score, r::TEXT AS row_text
FROM pg_temp.explore_reference(NULL, NULL, 60, 'diy-projects') r;
GRANT SELECT ON expected, expected_diy TO authenticated;

-- ─── The stored counts ────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.explore_scores es JOIN public.posts po ON po.id = es.post_id
   WHERE po.content LIKE 'post %'
     AND es.likes = (SELECT count(*) FROM public.likes l WHERE l.post_id = po.id)
     AND es.comments = (SELECT count(*) FROM public.comments c WHERE c.post_id = po.id)
     AND es.reposts = (SELECT count(*) FROM public.reposts r WHERE r.post_id = po.id)
     AND es.saves = (SELECT count(*) FROM public.saves s WHERE s.saved_post_id = po.id)),
  12, 'the triggers kept every post''s counts');

CREATE TEMP TABLE counted ON COMMIT DROP AS SELECT item_key, likes, comments, reposts, saves, score FROM public.explore_scores;
SELECT public.rebuild_explore_scores();
SELECT is(
  (SELECT count(*)::int FROM public.explore_scores es JOIN counted c USING (item_key)
   WHERE (es.likes, es.comments, es.reposts, es.saves, es.score) = (c.likes, c.comments, c.reposts, c.saves, c.score)),
  (SELECT count(*)::int FROM counted),
  'a rebuild from scratch agrees with the triggers, row for row');

-- ─── As the viewer ────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000104a0","role":"authenticated"}', true);

SELECT ok((SELECT count(*) FROM expected) > 10, 'the fixture fills more than a page of five');

SELECT is(
  (SELECT array_agg(row_text ORDER BY n) FROM public.explore_items(NULL, NULL, 60) WITH ORDINALITY AS g(kind, id, item_key, owner_profile_id, owner_username, title, image_url, media_type, tag_count, created_at, score, n)
    CROSS JOIN LATERAL (SELECT (g.kind, g.id, g.item_key, g.owner_profile_id, g.owner_username, g.title, g.image_url, g.media_type, g.tag_count, g.created_at, g.score)::TEXT AS row_text) t),
  (SELECT array_agg(row_text ORDER BY n) FROM expected),
  'one page of sixty: every row matches the previous function with everyone''s saves, field for field');

SELECT is(
  (SELECT array_agg(item_key ORDER BY n) FROM pg_temp.walk(5)),
  (SELECT array_agg(item_key ORDER BY n) FROM expected),
  'walked five at a time by cursor, the pages add up to the same list');

SELECT is(
  (SELECT array_agg(score ORDER BY n) FROM pg_temp.walk(5)),
  (SELECT array_agg(score ORDER BY n) FROM expected),
  'with exactly the same scores, so cursors clients already hold still compare');

SELECT is(
  (SELECT array_agg(item_key ORDER BY n) FROM pg_temp.walk(2, 'diy-projects')),
  (SELECT array_agg(item_key ORDER BY n) FROM expected_diy),
  'an interest narrows it exactly as before');

SELECT is((SELECT count(*)::int FROM public.explore_items(NULL, NULL, 60, 'diy-projects') WHERE kind = 'product'), 0,
  'a filtered grid has no products');

SELECT is(
  (SELECT count(*)::int FROM public.explore_items(NULL, NULL, 60)
   WHERE id IN ('10400000-0000-0000-0000-0000000000f1', '10400000-0000-0000-0000-0000000000f2',
                '10400000-0000-0000-0000-0000000000f3', '10400000-0000-0000-0000-0000000000f4',
                '10400000-0000-0000-0000-0000000000f5', '10400000-0000-0000-0000-0000000000b2')),
  0, 'still nothing of your own, private, across a block, ancient, or a private project');

SELECT is((SELECT image_url FROM public.explore_items(NULL, NULL, 60) WHERE id = '10400000-0000-0000-0000-0000000000a1'),
  'lamp-1.jpg', 'a product still shows its first photo');

-- ─── ONE-101: other people's saves count, and stay private ────────────

SELECT is((SELECT saves FROM public.explore_scores WHERE product_id = '10400000-0000-0000-0000-0000000000a2'), 9,
  'nine fans'' saves on Chair are counted, though the viewer can see none of them');
SELECT is((SELECT count(*)::int FROM public.saves WHERE saved_product_id = '10400000-0000-0000-0000-0000000000a2'), 0,
  'and the viewer still can''t read who saved it');

CREATE TEMP TABLE before_save ON COMMIT DROP AS
SELECT score FROM public.explore_items(NULL, NULL, 60) WHERE id = '10400000-0000-0000-0000-0000000000a1';
RESET ROLE;
INSERT INTO public.saves (profile_id, saved_product_id) SELECT id, '10400000-0000-0000-0000-0000000000a1' FROM fans WHERE n = 1;
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT score FROM public.explore_items(NULL, NULL, 60) WHERE id = '10400000-0000-0000-0000-0000000000a1')
    > (SELECT score FROM before_save),
  'someone else saving Lamp lifts its score for the viewer');

RESET ROLE;
DELETE FROM public.saves WHERE saved_product_id = '10400000-0000-0000-0000-0000000000a1' AND profile_id = (SELECT id FROM fans WHERE n = 1);
DELETE FROM public.likes WHERE post_id = '10400000-0000-0000-0000-000000000001' AND user_id = (SELECT id FROM fans WHERE n = 1);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT score FROM public.explore_items(NULL, NULL, 60) WHERE id = '10400000-0000-0000-0000-0000000000a1'),
  (SELECT score FROM before_save), 'and unsaving puts it back');
SELECT is((SELECT likes FROM public.explore_scores WHERE post_id = '10400000-0000-0000-0000-000000000001'), 6,
  'an unlike takes the count down');

-- ─── Who may read and write the table ─────────────────────────────────

SELECT throws_ok(
  $$UPDATE public.explore_scores SET likes = 1000 WHERE post_id = '10400000-0000-0000-0000-000000000001' RETURNING 1$$,
  '42501', NULL, 'nobody writes a score directly');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM public.explore_scores), 0, 'anonymous callers read no scores (ONE-109 lets them name the table, so a post card can embed it)');
RESET ROLE;

SELECT ok(NOT has_function_privilege('authenticated', 'public.rebuild_explore_scores()', 'EXECUTE'),
  'only the database owner can rebuild the scores');
SELECT ok(NOT has_function_privilege('anon', 'public.explore_items(double precision, text, integer, text)', 'EXECUTE'),
  'anon still cannot execute explore_items()');

SELECT * FROM finish();
ROLLBACK;
