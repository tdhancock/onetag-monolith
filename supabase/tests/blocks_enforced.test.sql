-- A block blocks, both ways (ONE-108). Runs against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- A: individual AI and private business AB, one post and one OneSnap each
--    way, and a comment. B: individual BI, a post and a OneSnap. B follows AI
--    and AI follows B, and B has asked to follow AB. Then A blocks B.
-- C: a bystander, whom the block doesn't touch.

BEGIN;
SELECT plan(30);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000108a0', 'a@one108.test', '{"username":"one108_a"}'),
  ('00000000-0000-0000-0000-0000000108a1', 'b@one108.test', '{"username":"one108_b"}'),
  ('00000000-0000-0000-0000-0000000108a2', 'c@one108.test', '{"username":"one108_c"}');
INSERT INTO public.profiles (user_id, profile_type, username, full_name, is_private)
VALUES ('00000000-0000-0000-0000-0000000108a0', 'business', 'one108_ab', 'A Works', true);
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one108_ab';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one108_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one108_ab') AS ab,
  (SELECT id FROM public.profiles WHERE username = 'one108_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one108_c') AS ci;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.posts (id, user_id, content) VALUES
  ('10800000-0000-0000-0000-000000000001', (SELECT ai FROM ids), 'by A'),
  ('10800000-0000-0000-0000-000000000002', (SELECT bi FROM ids), 'by B');
INSERT INTO public.stories (id, user_id, media_url) VALUES
  ('10800000-0000-0000-0000-000000000011', (SELECT ai FROM ids), 'a.jpg'),
  ('10800000-0000-0000-0000-000000000012', (SELECT bi FROM ids), 'b.jpg');
INSERT INTO public.comments (id, post_id, user_id, content) VALUES
  ('10800000-0000-0000-0000-000000000021', '10800000-0000-0000-0000-000000000001', (SELECT ai FROM ids), 'A on A');
INSERT INTO public.follows (follower_id, followed_id)
SELECT bi, ai FROM ids UNION ALL SELECT ai, bi FROM ids UNION ALL SELECT ci, ai FROM ids UNION ALL SELECT ci, bi FROM ids;
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT bi, ab FROM ids;

-- ─── A blocks B ───────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a0","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.blocks (blocker_id, blocked_id)
    VALUES ('00000000-0000-0000-0000-0000000108a0', '00000000-0000-0000-0000-0000000108a1')$$,
  'A blocks B');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.follows f, ids
   WHERE (f.follower_id = ids.bi AND f.followed_id IN (ids.ai, ids.ab))
      OR (f.followed_id = ids.bi AND f.follower_id IN (ids.ai, ids.ab))),
  0, 'the block removed the follows between them, both ways');
SELECT is((SELECT count(*)::int FROM public.follow_requests r, ids WHERE r.requester_profile_id = ids.bi), 0,
  'and B''s pending request to A''s business');
SELECT is((SELECT count(*)::int FROM public.follows f, ids WHERE f.follower_id = ids.ci), 2,
  'the bystander''s follows are untouched');

-- ─── As B, the blocked ────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.posts WHERE id = '10800000-0000-0000-0000-000000000001'), 0,
  'B can''t read A''s post, even by id');
SELECT is((SELECT count(*)::int FROM public.stories WHERE id = '10800000-0000-0000-0000-000000000011'), 0,
  'nor A''s OneSnap');
SELECT is((SELECT count(*)::int FROM public.feed_posts((SELECT bi FROM ids)) WHERE id = '10800000-0000-0000-0000-000000000001'), 0,
  'A''s post is gone from B''s feed');
SELECT is((SELECT count(*)::int FROM public.posts WHERE id = '10800000-0000-0000-0000-000000000002'), 1,
  'B still reads their own post');

SELECT throws_ok($$INSERT INTO public.follows (follower_id, followed_id) SELECT bi, ai FROM ids$$,
  '42501', NULL, 'B can''t follow A again');
SELECT throws_ok($$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT bi, ab FROM ids$$,
  '42501', NULL, 'nor ask to follow A''s private business');
SELECT throws_ok($$INSERT INTO public.likes (post_id, user_id) SELECT '10800000-0000-0000-0000-000000000001', bi FROM ids$$,
  '42501', NULL, 'nor like A''s post');
SELECT throws_ok($$INSERT INTO public.reposts (post_id, user_id) SELECT '10800000-0000-0000-0000-000000000001', bi FROM ids$$,
  '42501', NULL, 'nor repost it');
SELECT throws_ok($$INSERT INTO public.comments (post_id, user_id, content) SELECT '10800000-0000-0000-0000-000000000001', bi, 'hi' FROM ids$$,
  '42501', NULL, 'nor comment on it');
SELECT throws_ok($$INSERT INTO public.comment_likes (comment_id, user_id) SELECT '10800000-0000-0000-0000-000000000021', bi FROM ids$$,
  '42501', NULL, 'nor like A''s comment');
SELECT throws_ok($$INSERT INTO public.story_likes (story_id, user_id) SELECT '10800000-0000-0000-0000-000000000011', bi FROM ids$$,
  '42501', NULL, 'nor like A''s OneSnap');
SELECT throws_ok($$INSERT INTO public.messages (sender_id, receiver_id, text) SELECT bi, ai, 'hi' FROM ids$$,
  '42501', NULL, 'nor message A');
SELECT throws_ok($$INSERT INTO public.messages (sender_id, receiver_id, text) SELECT bi, ab, 'hi' FROM ids$$,
  '42501', NULL, 'nor A''s business: a block covers the whole account');

-- ─── As A, the blocker: the block holds this way too ──────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a0","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.posts WHERE id = '10800000-0000-0000-0000-000000000002'), 0,
  'A can''t read B''s post either');
SELECT is((SELECT count(*)::int FROM public.stories WHERE id = '10800000-0000-0000-0000-000000000012'), 0,
  'nor B''s OneSnap');
SELECT throws_ok($$INSERT INTO public.follows (follower_id, followed_id) SELECT ai, bi FROM ids$$,
  '42501', NULL, 'A can''t follow B');
SELECT throws_ok($$INSERT INTO public.messages (sender_id, receiver_id, text) SELECT ai, bi, 'hi' FROM ids$$,
  '42501', NULL, 'nor message B: it used to let the blocker through');
SELECT throws_ok($$INSERT INTO public.comments (post_id, user_id, content) SELECT '10800000-0000-0000-0000-000000000002', ai, 'hi' FROM ids$$,
  '42501', NULL, 'nor comment on B''s post');
SELECT is((SELECT count(*)::int FROM public.posts WHERE id = '10800000-0000-0000-0000-000000000001'), 1,
  'A still reads their own post');

-- ─── The bystander sees both ──────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a2","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.posts WHERE id::text LIKE '10800000%'), 2,
  'someone outside the block reads both posts');
SELECT is((SELECT count(*)::int FROM public.stories WHERE id::text LIKE '10800000%'), 2,
  'and both OneSnaps, since they follow both');
SELECT lives_ok($$INSERT INTO public.likes (post_id, user_id) SELECT '10800000-0000-0000-0000-000000000002', ci FROM ids$$,
  'and can still like B''s post');

-- ─── Unblocking restores nothing, but lets them start again ───────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a0","role":"authenticated"}', true);
DELETE FROM public.blocks WHERE blocker_id = '00000000-0000-0000-0000-0000000108a0';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.follows f, ids WHERE f.follower_id = ids.bi OR f.followed_id = ids.bi AND f.follower_id <> ids.ci), 0,
  'unblocking brings no follow back');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000108a1","role":"authenticated"}', true);
SELECT lives_ok($$INSERT INTO public.follows (follower_id, followed_id) SELECT bi, ai FROM ids$$,
  'after the unblock, B may follow A again');

-- ─── Who may call the helpers ─────────────────────────────────────────

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.hidden_profile_ids()', 'EXECUTE'),
  'anon cannot execute hidden_profile_ids()');
SELECT ok(NOT has_function_privilege('authenticated', 'public.sever_on_block()', 'EXECUTE'),
  'sever_on_block() runs only as a trigger');

SELECT * FROM finish();
ROLLBACK;
