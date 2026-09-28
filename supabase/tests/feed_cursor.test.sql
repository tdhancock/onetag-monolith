-- The feed pages by (created_at, id) (ONE-113). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- V follows A. A has 25 posts sharing one created_at — an import, say — and
-- three older ones. V has two newer posts of their own.

BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000113a0', 'v@one113.test', '{"username":"one113_v"}'),
  ('00000000-0000-0000-0000-0000000113a1', 'a@one113.test', '{"username":"one113_a"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one113_v') AS v,
  (SELECT id FROM public.profiles WHERE username = 'one113_a') AS a,
  now() - interval '1 hour' AS tied_at;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.follows (follower_id, followed_id) SELECT v, a FROM ids;
INSERT INTO public.posts (user_id, content, created_at)
SELECT a, 'tied ' || g, tied_at FROM ids, generate_series(1, 25) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT a, 'older ' || g, tied_at - g * interval '1 minute' FROM ids, generate_series(1, 3) g;
INSERT INTO public.posts (user_id, content, created_at)
SELECT v, 'mine ' || g, now() - g * interval '1 minute' FROM ids, generate_series(1, 2) g;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000113a0","role":"authenticated"}', true);

-- Walk the feed 20 at a time, as the app does: each page starts after the
-- last post of the one before, by its time and id.
CREATE TEMP TABLE walked (content TEXT, created_at TIMESTAMPTZ, id UUID, page INT, n INT) ON COMMIT DROP;
GRANT ALL ON walked TO authenticated;
DO $$
DECLARE
  cursor_at TIMESTAMPTZ := NULL;
  cursor_id UUID := NULL;
  pages INT := 0;
  got INT;
BEGIN
  LOOP
    pages := pages + 1;
    INSERT INTO walked
    SELECT f.content, f.created_at, f.id, pages, row_number() OVER ()
    FROM public.feed_posts((SELECT v FROM ids), cursor_at, NULL, 20, cursor_id) f;
    GET DIAGNOSTICS got = ROW_COUNT;
    EXIT WHEN got < 20 OR pages > 10;
    SELECT w.created_at, w.id INTO cursor_at, cursor_id FROM walked w WHERE w.page = pages AND w.n = 20;
  END LOOP;
END $$;

SELECT is((SELECT count(*)::int FROM walked WHERE content LIKE 'tied %'), 25,
  'walking the feed 20 at a time shows all 25 posts that share a timestamp');
SELECT is((SELECT count(DISTINCT id)::int FROM walked WHERE content LIKE 'tied %'), 25, 'each once');
SELECT is((SELECT count(*)::int FROM walked), 30, 'and every other post, once: 30 in all');
SELECT is((SELECT array_agg(n ORDER BY page) FROM (SELECT page, count(*)::int AS n FROM walked GROUP BY page) p),
  ARRAY[20, 10], 'in a page of 20, then the 10 left');
SELECT ok(
  (SELECT count(*) FROM walked WHERE page = 1 AND content LIKE 'tied %') BETWEEN 1 AND 24,
  'the tie straddles the page boundary, which is the case this pins');
SELECT is(
  (SELECT array_agg(content ORDER BY page, n) FROM walked WHERE content NOT LIKE 'tied %'),
  ARRAY['mine 1', 'mine 2', 'older 1', 'older 2', 'older 3'],
  'newest first around the tie');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM walked w1 JOIN walked w2
      ON (w2.page, w2.n) = (w1.page, w1.n + 1) OR (w2.page = w1.page + 1 AND w2.n = 1 AND w1.n = 20)
    WHERE (w2.created_at, w2.id) >= (w1.created_at, w1.id)),
  'strictly ordered by time, then id, across the boundary too');

-- ─── A cursor with only a time ────────────────────────────────────────

SELECT is(
  (SELECT array_agg(content ORDER BY created_at DESC)
   FROM public.feed_posts((SELECT v FROM ids), (SELECT tied_at FROM ids))),
  ARRAY['older 1', 'older 2', 'older 3'],
  'given only a time, it returns what came before that time, as before');

-- ─── Limits, as before ────────────────────────────────────────────────

SELECT is((SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids), NULL, NULL, 500)), 30,
  'a page never holds more than 60, and here there are 30');
SELECT is((SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids), NULL, NULL, 0)), 1,
  'nor fewer than one');

RESET ROLE;
SELECT hasnt_function('public', 'feed_posts', ARRAY['uuid', 'timestamp with time zone', 'text', 'integer'],
  'the old four-argument feed_posts is gone, so no call is ambiguous');
SELECT ok(
  NOT has_function_privilege('anon', 'public.feed_posts(uuid, timestamptz, text, integer, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.feed_posts(uuid, timestamptz, text, integer, uuid)', 'EXECUTE'),
  'signed-in users call it; anon can''t');

SELECT * FROM finish();
ROLLBACK;
