-- The feed chosen from the follow list returns what the time walk did
-- (ONE-116). Runs against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. The reference below is
-- feed_posts as ONE-113 left it, verbatim, run under the same RLS.
--
-- V follows A (busy, with a run of posts sharing one timestamp), Q (quiet:
-- old posts only) and P (private). V has posts of their own. N posts but
-- isn't followed. L follows nobody and has two posts.

BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000116a0', 'v@one116.test', '{"username":"one116_v"}'),
  ('00000000-0000-0000-0000-0000000116a1', 'a@one116.test', '{"username":"one116_a"}'),
  ('00000000-0000-0000-0000-0000000116a2', 'q@one116.test', '{"username":"one116_q"}'),
  ('00000000-0000-0000-0000-0000000116a3', 'p@one116.test', '{"username":"one116_p"}'),
  ('00000000-0000-0000-0000-0000000116a4', 'n@one116.test', '{"username":"one116_n"}'),
  ('00000000-0000-0000-0000-0000000116a5', 'l@one116.test', '{"username":"one116_l"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one116_v') AS v,
  (SELECT id FROM public.profiles WHERE username = 'one116_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one116_q') AS q,
  (SELECT id FROM public.profiles WHERE username = 'one116_p') AS p,
  (SELECT id FROM public.profiles WHERE username = 'one116_n') AS n,
  (SELECT id FROM public.profiles WHERE username = 'one116_l') AS l;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE username = 'one116_p';
INSERT INTO public.follows (follower_id, followed_id) SELECT v, a FROM ids UNION ALL SELECT v, q FROM ids UNION ALL SELECT v, p FROM ids;

-- A: 40 posts an hour apart, every fifth with an interest, then 7 sharing one
-- timestamp. Q: three posts, months old. P: 5 posts. V: 4. N: 10, unfollowed.
INSERT INTO public.posts (user_id, content, created_at, interest_slug)
SELECT a, 'a ' || g, now() - g * interval '1 hour', CASE WHEN g % 5 = 0 THEN 'diy-projects' END FROM ids, generate_series(1, 40) g;
INSERT INTO public.posts (user_id, content, created_at, interest_slug)
SELECT a, 'a tied ' || g, now() - interval '90 minutes', CASE WHEN g % 2 = 0 THEN 'diy-projects' END FROM ids, generate_series(1, 7) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT q, 'q ' || g, now() - interval '120 days' - g * interval '1 day' FROM ids, generate_series(1, 3) g;
INSERT INTO public.posts (user_id, content, created_at, interest_slug)
SELECT p, 'p ' || g, now() - g * interval '7 hours', CASE WHEN g = 2 THEN 'diy-projects' END FROM ids, generate_series(1, 5) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT v, 'v ' || g, now() - g * interval '11 hours' FROM ids, generate_series(1, 4) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT n, 'n ' || g, now() - g * interval '30 minutes' FROM ids, generate_series(1, 10) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT l, 'l ' || g, now() - g * interval '1 day' FROM ids, generate_series(1, 2) g;

-- feed_posts as ONE-113 left it: the time walk.
CREATE FUNCTION pg_temp.feed_walk(p_viewer UUID, p_before TIMESTAMPTZ, p_interest TEXT, p_limit INTEGER, p_before_id UUID)
RETURNS SETOF public.posts LANGUAGE sql STABLE AS $$
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

-- Walk a feed to its end, `page` posts at a time, each page starting after
-- the last post of the one before, as the app does. Returns every id, in order.
CREATE FUNCTION pg_temp.walk(p_viewer UUID, p_interest TEXT, p_page INTEGER, p_reference BOOLEAN)
RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE
  cursor_at TIMESTAMPTZ;
  cursor_id UUID;
  page_ids UUID[];
  page_ats TIMESTAMPTZ[];
  walked UUID[] := '{}';
  pages INTEGER := 0;
BEGIN
  LOOP
    pages := pages + 1;
    IF p_reference THEN
      SELECT array_agg(f.id ORDER BY f.created_at DESC, f.id DESC), array_agg(f.created_at ORDER BY f.created_at DESC, f.id DESC)
      INTO page_ids, page_ats FROM pg_temp.feed_walk(p_viewer, cursor_at, p_interest, p_page, cursor_id) f;
    ELSE
      SELECT array_agg(f.id ORDER BY f.created_at DESC, f.id DESC), array_agg(f.created_at ORDER BY f.created_at DESC, f.id DESC)
      INTO page_ids, page_ats FROM public.feed_posts(p_viewer, cursor_at, p_interest, p_page, cursor_id) f;
    END IF;
    walked := walked || coalesce(page_ids, '{}');
    EXIT WHEN coalesce(cardinality(page_ids), 0) < p_page OR pages > 100;
    cursor_at := page_ats[cardinality(page_ats)];
    cursor_id := page_ids[cardinality(page_ids)];
  END LOOP;
  RETURN walked;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000116a0","role":"authenticated"}', true);

-- ─── The same feed, page by page ──────────────────────────────────────

SELECT is(pg_temp.walk((SELECT v FROM ids), NULL, 3, false), pg_temp.walk((SELECT v FROM ids), NULL, 3, true),
  'three at a time, the whole feed matches the walk, ties and quiet follows included');
SELECT is(pg_temp.walk((SELECT v FROM ids), NULL, 20, false), pg_temp.walk((SELECT v FROM ids), NULL, 20, true),
  'twenty at a time, as the app pages it');
SELECT is(pg_temp.walk((SELECT v FROM ids), NULL, 60, false), pg_temp.walk((SELECT v FROM ids), NULL, 60, true),
  'and at the most a page may hold');
SELECT is(pg_temp.walk((SELECT v FROM ids), 'diy-projects', 2, false), pg_temp.walk((SELECT v FROM ids), 'diy-projects', 2, true),
  'narrowed to an interest, it matches too');
SELECT is(cardinality(pg_temp.walk((SELECT v FROM ids), NULL, 3, false)), 59,
  'every post by V and the three they follow, once each');
SELECT is(
  (SELECT count(*)::int FROM unnest(pg_temp.walk((SELECT v FROM ids), NULL, 3, false)) w(id)
   JOIN public.posts po ON po.id = w.id WHERE po.content LIKE 'n %'),
  0, 'and nothing by someone V doesn''t follow');
SELECT is(
  (SELECT array_agg(po.content ORDER BY w.ord) FROM unnest(pg_temp.walk((SELECT v FROM ids), NULL, 3, false)) WITH ORDINALITY w(id, ord)
   JOIN public.posts po ON po.id = w.id WHERE po.content LIKE 'q %'),
  ARRAY['q 1', 'q 2', 'q 3'], 'the quiet account''s months-old posts come last, in order');

-- ─── Someone who follows nobody ───────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000116a5","role":"authenticated"}', true);
SELECT is(
  (SELECT array_agg(content ORDER BY created_at DESC) FROM public.feed_posts((SELECT l FROM ids))),
  ARRAY['l 1', 'l 2'], 'someone following nobody sees their own posts');
SELECT is(pg_temp.walk((SELECT l FROM ids), NULL, 1, false), pg_temp.walk((SELECT l FROM ids), NULL, 1, true),
  'as the walk did');

-- ─── Only one's own feed ──────────────────────────────────────────────

SELECT is((SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids))), 0,
  'asked for someone else''s feed, it returns nothing');
SELECT is((SELECT count(*)::int FROM public.feed_candidates((SELECT v FROM ids), NULL, NULL, NULL, 20)), 0,
  'nor does feed_candidates(), which reads past RLS, for anyone but the feed''s owner');

-- ─── The private account: only while followed ─────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000116a0","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids), NULL, NULL, 60) WHERE content LIKE 'p %'),
  5, 'a private account V follows is in V''s feed');
RESET ROLE;
DELETE FROM public.follows WHERE follower_id = (SELECT v FROM ids) AND followed_id = (SELECT p FROM ids);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000116a0","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids), NULL, NULL, 60) WHERE content LIKE 'p %'),
  0, 'and gone from it once V unfollows');

RESET ROLE;
SELECT ok(
  NOT has_function_privilege('anon', 'public.feed_candidates(uuid, timestamptz, uuid, text, integer)', 'EXECUTE'),
  'anon cannot call feed_candidates()');

SELECT * FROM finish();
ROLLBACK;
