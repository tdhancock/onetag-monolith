-- Reads that no longer put an id list in the URL (ONE-106). Runs against a
-- real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. Each function returns
-- what the read it replaced returned, under the caller's own RLS.
--
-- V: the viewer, following A and private P. B: not followed, and blocked by V.
-- C: nobody V follows or blocks. P: private.
-- V messaged A; B messaged V; A messaged B. V blocked B's account.

BEGIN;
SELECT plan(15);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000106a0', 'v@one106.test', '{"username":"one106_v"}'),
  ('00000000-0000-0000-0000-0000000106a1', 'a@one106.test', '{"username":"one106_a"}'),
  ('00000000-0000-0000-0000-0000000106a2', 'b@one106.test', '{"username":"one106_b"}'),
  ('00000000-0000-0000-0000-0000000106a3', 'p@one106.test', '{"username":"one106_p"}'),
  ('00000000-0000-0000-0000-0000000106a4', 'c@one106.test', '{"username":"one106_c"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one106_v') AS v,
  (SELECT id FROM public.profiles WHERE username = 'one106_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one106_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'one106_p') AS p;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE username = 'one106_p';
INSERT INTO public.follows (follower_id, followed_id) SELECT v, a FROM ids;
INSERT INTO public.follows (follower_id, followed_id) SELECT v, p FROM ids;

INSERT INTO public.posts (id, user_id, content, created_at, interest_slug) VALUES
  ('10600000-0000-0000-0000-000000000001', (SELECT v FROM ids), 'mine', now() - interval '1 hour', NULL),
  ('10600000-0000-0000-0000-000000000002', (SELECT a FROM ids), 'a new', now() - interval '2 hours', 'diy-projects'),
  ('10600000-0000-0000-0000-000000000003', (SELECT a FROM ids), 'a old', now() - interval '3 hours', NULL),
  ('10600000-0000-0000-0000-000000000004', (SELECT b FROM ids), 'b', now(), NULL),
  ('10600000-0000-0000-0000-000000000005', (SELECT p FROM ids), 'p', now(), NULL);

INSERT INTO public.stories (user_id, media_url, created_at) VALUES
  ((SELECT a FROM ids), 'a.jpg', now() - interval '1 hour'),
  ((SELECT a FROM ids), 'stale.jpg', now() - interval '30 hours'),
  ((SELECT b FROM ids), 'b.jpg', now());

INSERT INTO public.messages (sender_id, receiver_id, text)
SELECT v, a, 'hi' FROM ids UNION ALL SELECT b, v, 'yo' FROM ids UNION ALL SELECT a, b, 'not v' FROM ids;
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000106a0', '00000000-0000-0000-0000-0000000106a2');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000106a0","role":"authenticated"}', true);

-- ─── The feed ─────────────────────────────────────────────────────────

SELECT is(
  (SELECT array_agg(content ORDER BY created_at DESC) FROM public.feed_posts((SELECT v FROM ids))),
  ARRAY['p', 'mine', 'a new', 'a old'],
  'the feed: my posts and those of everyone I follow, private ones included since I follow them, newest first');
SELECT is(
  (SELECT array_agg(content ORDER BY created_at DESC)
   FROM public.feed_posts((SELECT v FROM ids), now() - interval '90 minutes')),
  ARRAY['a new', 'a old'], 'a cursor takes only what is older');
SELECT is(
  (SELECT array_agg(content) FROM public.feed_posts((SELECT v FROM ids), NULL, 'diy-projects')),
  ARRAY['a new'], 'an interest narrows it in the query');
SELECT is((SELECT count(*)::int FROM public.feed_posts((SELECT v FROM ids), NULL, NULL, 2)), 2,
  'a page is no longer than asked');
SELECT is(
  (SELECT count(*)::int FROM public.feed_posts((SELECT b FROM ids))
   WHERE id = '10600000-0000-0000-0000-000000000005'),
  0, 'asked as someone else, RLS still hides a private profile I don''t follow... through them');

-- ─── The OneSnap reel ─────────────────────────────────────────────────

SELECT is(
  (SELECT array_agg(media_url) FROM public.reel_stories((SELECT v FROM ids), now() - interval '24 hours')),
  ARRAY['a.jpg'], 'the reel: live OneSnaps of everyone I follow, not stale ones, not strangers''');

-- ─── Messages ─────────────────────────────────────────────────────────

-- chat_list replaced chat_partners (ONE-110); lists_past_the_cap pins its order.
SELECT is(
  (SELECT array_agg(username ORDER BY username) FROM public.chat_list((SELECT v FROM ids))),
  ARRAY['one106_a', 'one106_b'], 'everyone I have messaged, either way');
SELECT is(
  (SELECT array_agg(username ORDER BY username) FROM public.chat_list((SELECT a FROM ids))),
  ARRAY['one106_v'], 'asked for someone else, only their conversations with me show');

-- ─── Blocks ───────────────────────────────────────────────────────────

SELECT is(
  (SELECT array_agg(username) FROM public.blocked_profiles('00000000-0000-0000-0000-0000000106a0')),
  ARRAY['one106_b'], 'the profiles of the accounts I blocked');
SELECT is(
  (SELECT count(*)::int FROM public.blocked_profiles('00000000-0000-0000-0000-0000000106a1')),
  0, 'and nobody else''s blocks');
SELECT is(
  (SELECT array_agg(a ORDER BY a) FROM public.accounts_for_usernames(ARRAY['one106_a', 'one106_b', 'nobody']) AS a),
  ARRAY['00000000-0000-0000-0000-0000000106a1'::uuid, '00000000-0000-0000-0000-0000000106a2'::uuid],
  'handles resolve to their accounts; an unknown one drops out');

-- ─── Suggestions ──────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.suggested_profiles((SELECT v FROM ids), 50)
   WHERE username IN ('one106_v', 'one106_a', 'one106_p', 'one106_b')),
  0, 'suggestions leave out me, everyone I follow, and anyone across a block (ONE-108)');
SELECT ok(
  (SELECT count(*) FROM public.suggested_profiles((SELECT v FROM ids), 50) WHERE username = 'one106_c') = 1,
  'and offer someone I don''t follow');

-- ─── Who may call them ────────────────────────────────────────────────

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.feed_posts(uuid, timestamptz, text, integer)', 'EXECUTE'),
  'anon cannot execute feed_posts()');
SELECT ok(
  has_function_privilege('authenticated', 'public.feed_posts(uuid, timestamptz, text, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reel_stories(uuid, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.chat_list(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.blocked_profiles(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.accounts_for_usernames(text[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.suggested_profiles(uuid, integer)', 'EXECUTE'),
  'signed-in users can call all six');

SELECT * FROM finish();
ROLLBACK;
