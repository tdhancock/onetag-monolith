-- Notifications come from events, never from clients (ONE-107). Runs
-- against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. now() is fixed for the
-- whole transaction, so "24 hours ago" is simulated by moving a
-- notification's created_at back.
--
-- A: posts, and is followed. B: likes, reposts, comments on, mentions and
-- follows A. C: mentioned. D: blocked by A. P: private, asked to follow by B.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000107a0', 'a@one107.test', '{"username":"one107_a"}'),
  ('00000000-0000-0000-0000-0000000107a1', 'b@one107.test', '{"username":"one107_b"}'),
  ('00000000-0000-0000-0000-0000000107a2', 'c@one107.test', '{"username":"one107_c"}'),
  ('00000000-0000-0000-0000-0000000107a3', 'd@one107.test', '{"username":"one107_d"}'),
  ('00000000-0000-0000-0000-0000000107a4', 'p@one107.test', '{"username":"one107_p"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one107_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one107_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'one107_c') AS c,
  (SELECT id FROM public.profiles WHERE username = 'one107_d') AS d,
  (SELECT id FROM public.profiles WHERE username = 'one107_p') AS p;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE username = 'one107_p';
INSERT INTO public.posts (id, user_id, content) VALUES
  ('10700000-0000-0000-0000-000000000001', (SELECT a FROM ids), 'A''s post');
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000107a0', '00000000-0000-0000-0000-0000000107a3');

-- What A (or anyone) has been told, read as the table's owner.
CREATE FUNCTION pg_temp.told(p_receiver UUID, p_type TEXT) RETURNS INTEGER
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE receiver_id = p_receiver AND type = p_type;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);

-- ─── Clients write none ───────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.notifications (sender_id, receiver_id, type) SELECT b, a, 'follow' FROM ids$$,
  '42501', NULL, 'a client can''t write a notification, even as itself');

-- ─── Likes, reposts, comments and mentions ────────────────────────────

INSERT INTO public.likes (post_id, user_id) SELECT '10700000-0000-0000-0000-000000000001', b FROM ids;
INSERT INTO public.reposts (post_id, user_id) SELECT '10700000-0000-0000-0000-000000000001', b FROM ids;
INSERT INTO public.comments (id, post_id, user_id, content)
SELECT '10700000-0000-0000-0000-000000000021', '10700000-0000-0000-0000-000000000001', b,
       'hey @one107_c, @one107_c again, @nobody_here and me @one107_b — a comment well past fifty characters'
FROM ids;
INSERT INTO public.posts (id, user_id, content)
SELECT '10700000-0000-0000-0000-000000000002', b, 'look @one107_a' FROM ids;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a0","role":"authenticated"}', true);
-- A likes their own post: nobody is told about their own action.
INSERT INTO public.likes (post_id, user_id) SELECT '10700000-0000-0000-0000-000000000001', a FROM ids;
RESET ROLE;

SELECT is(pg_temp.told((SELECT a FROM ids), 'like'), 1, 'a like tells the post''s author, once');
SELECT is(
  (SELECT post_id FROM public.notifications WHERE type = 'like' AND receiver_id = (SELECT a FROM ids)),
  '10700000-0000-0000-0000-000000000001'::uuid, 'naming the post');
SELECT is(
  (SELECT sender_id FROM public.notifications WHERE type = 'like' AND receiver_id = (SELECT a FROM ids)),
  (SELECT b FROM ids), 'from the one who liked it, not the author''s own like');
SELECT is(pg_temp.told((SELECT a FROM ids), 'repost'), 1, 'a repost tells the author');
SELECT is(pg_temp.told((SELECT a FROM ids), 'comment'), 1, 'a comment tells the author');
SELECT is(
  (SELECT comment_id FROM public.notifications WHERE type = 'comment' AND receiver_id = (SELECT a FROM ids)),
  '10700000-0000-0000-0000-000000000021'::uuid, 'naming the comment');
SELECT is(
  (SELECT content FROM public.notifications WHERE type = 'comment' AND receiver_id = (SELECT a FROM ids)),
  'hey @one107_c, @one107_c again, @nobody_here and m', 'with its first 50 characters, as the app wrote them');
SELECT is(pg_temp.told((SELECT c FROM ids), 'mention'), 1, 'a handle mentioned twice is told once');
SELECT is(
  (SELECT comment_id FROM public.notifications WHERE type = 'mention' AND receiver_id = (SELECT c FROM ids)),
  '10700000-0000-0000-0000-000000000021'::uuid, 'and the mention names the comment it was in');
SELECT is(pg_temp.told((SELECT b FROM ids), 'mention'), 0, 'mentioning yourself tells nobody');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'mention' AND receiver_id NOT IN (SELECT c FROM ids UNION SELECT a FROM ids)), 0,
  'an unknown handle tells nobody');
SELECT is(
  (SELECT post_id FROM public.notifications WHERE type = 'mention' AND receiver_id = (SELECT a FROM ids)),
  '10700000-0000-0000-0000-000000000002'::uuid, 'a mention in a post tells the one mentioned, naming the post');

-- ─── Across a block, nobody is told anything ──────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a3","role":"authenticated"}', true);
INSERT INTO public.posts (user_id, content) SELECT d, 'hi @one107_a' FROM ids;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a0","role":"authenticated"}', true);
INSERT INTO public.posts (user_id, content) SELECT a, 'hi @one107_d' FROM ids;
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.notifications n, ids WHERE n.sender_id = ids.d AND n.receiver_id = ids.a), 0,
  'someone blocked can''t reach the blocker with a mention');
SELECT is((SELECT count(*)::int FROM public.notifications n, ids WHERE n.sender_id = ids.a AND n.receiver_id = ids.d), 0,
  'nor the blocker them');

-- ─── Follows: once per follower per 24 hours ──────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);
INSERT INTO public.follows (follower_id, followed_id) SELECT b, a FROM ids;
DELETE FROM public.follows WHERE follower_id = (SELECT b FROM ids) AND followed_id = (SELECT a FROM ids);
INSERT INTO public.follows (follower_id, followed_id) SELECT b, a FROM ids;
DELETE FROM public.follows WHERE follower_id = (SELECT b FROM ids) AND followed_id = (SELECT a FROM ids);
INSERT INTO public.follows (follower_id, followed_id) SELECT b, a FROM ids;
RESET ROLE;

SELECT is(pg_temp.told((SELECT a FROM ids), 'follow'), 1,
  'following, unfollowing and following again tells them once');

UPDATE public.notifications SET created_at = now() - interval '25 hours'
WHERE type = 'follow' AND receiver_id = (SELECT a FROM ids);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);
DELETE FROM public.follows WHERE follower_id = (SELECT b FROM ids) AND followed_id = (SELECT a FROM ids);
INSERT INTO public.follows (follower_id, followed_id) SELECT b, a FROM ids;
RESET ROLE;

SELECT is(pg_temp.told((SELECT a FROM ids), 'follow'), 2, 'a follow more than 24 hours later tells them again');

-- ─── Follow requests ──────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT b, p FROM ids;
RESET ROLE;
SELECT is(pg_temp.told((SELECT p FROM ids), 'follow_request'), 1, 'a request tells the private profile''s owner');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);
DELETE FROM public.follow_requests WHERE requester_profile_id = (SELECT b FROM ids);
RESET ROLE;
SELECT is(pg_temp.told((SELECT p FROM ids), 'follow_request'), 0,
  'cancelling it takes its notification away, so it can''t lead to an empty screen');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a1","role":"authenticated"}', true);
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT b, p FROM ids;
RESET ROLE;
UPDATE public.notifications SET is_read = true WHERE type = 'follow_request' AND receiver_id = (SELECT p FROM ids);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000107a4","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.approve_follow_request((SELECT id FROM public.follow_requests WHERE requester_profile_id = (SELECT b FROM ids)))$$,
  'the owner approves the request');
RESET ROLE;

SELECT is(pg_temp.told((SELECT p FROM ids), 'follow'), 0,
  'approving doesn''t tell the owner someone started following them');
SELECT is(pg_temp.told((SELECT p FROM ids), 'follow_request'), 1,
  'a request''s notification the owner already read stays in their history');

-- ─── Who may call the helpers ─────────────────────────────────────────

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.notify(text, uuid, uuid, uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.notify(text, uuid, uuid, uuid, uuid, text)', 'EXECUTE'),
  'nobody but the triggers calls notify()');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.notify_mentions(text, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.blocked_between(uuid, uuid)', 'EXECUTE'),
  'nor notify_mentions() or blocked_between()');

SELECT * FROM finish();
ROLLBACK;
