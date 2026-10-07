-- Follow requests for private accounts (ONE-63). Runs against a real
-- database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- O: owns private profile o, with one post.
-- S: a stranger who asks to follow o.
-- R: another who asks, is declined, asks again and cancels.
-- T: asks, and is let in when o goes public.
-- B: blocked O.  C: blocked by O.
-- P: owns public profile p.

BEGIN;
SELECT plan(29);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000063a0', 'o@one63.test', '{"username":"one63_o"}'),
  ('00000000-0000-0000-0000-0000000063a1', 's@one63.test', '{"username":"one63_s"}'),
  ('00000000-0000-0000-0000-0000000063a2', 'r@one63.test', '{"username":"one63_r"}'),
  ('00000000-0000-0000-0000-0000000063a3', 't@one63.test', '{"username":"one63_t"}'),
  ('00000000-0000-0000-0000-0000000063a4', 'b@one63.test', '{"username":"one63_b"}'),
  ('00000000-0000-0000-0000-0000000063a5', 'c@one63.test', '{"username":"one63_c"}'),
  ('00000000-0000-0000-0000-0000000063a6', 'p@one63.test', '{"username":"one63_p"}');

INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000063a4', '00000000-0000-0000-0000-0000000063a0'),
  ('00000000-0000-0000-0000-0000000063a0', '00000000-0000-0000-0000-0000000063a5');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one63_o') AS o,
  (SELECT id FROM public.profiles WHERE username = 'one63_s') AS s,
  (SELECT id FROM public.profiles WHERE username = 'one63_r') AS r,
  (SELECT id FROM public.profiles WHERE username = 'one63_t') AS t,
  (SELECT id FROM public.profiles WHERE username = 'one63_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'one63_c') AS c,
  (SELECT id FROM public.profiles WHERE username = 'one63_p') AS p;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE id = (SELECT o FROM ids);
INSERT INTO public.posts (user_id, content) SELECT o, 'private post' FROM ids;

SET LOCAL ROLE authenticated;

-- ─── A stranger asks ──────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.follows (follower_id, followed_id) SELECT s, o FROM ids$$,
  '42501', NULL, 'a stranger can''t follow a private profile directly');

SELECT lives_ok(
  $$INSERT INTO public.follows (follower_id, followed_id) SELECT s, p FROM ids$$,
  'a public profile is still followed directly');

SELECT lives_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT s, o FROM ids$$,
  'a stranger can ask to follow a private profile');

SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT s, o FROM ids$$,
  '23505', NULL, 'and asks once');

SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT s, p FROM ids$$,
  '42501', NULL, 'a public profile takes no requests');

SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT r, o FROM ids$$,
  '42501', NULL, 'nobody asks as someone else');

SELECT is((SELECT count(*)::int FROM public.posts WHERE user_id = (SELECT o FROM ids)), 0,
  'while the request is pending the posts stay hidden');

SELECT is((SELECT count(*)::int FROM public.follow_requests), 1,
  'the requester sees their own request');

SELECT throws_ok(
  $$SELECT public.approve_follow_request((SELECT id FROM public.follow_requests LIMIT 1))$$,
  '42501', NULL, 'the requester can''t approve their own request');

-- ─── Blocks refuse a request, either way ──────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a4","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT b, o FROM ids$$,
  '42501', NULL, 'someone who blocked the owner can''t ask');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a5","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT c, o FROM ids$$,
  '42501', NULL, 'someone the owner blocked can''t ask');

-- ─── A second requester sees only their own ───────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a2","role":"authenticated"}', true);
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT r, o FROM ids;
SELECT is((SELECT count(*)::int FROM public.follow_requests), 1,
  'another requester sees their request and not the stranger''s');

-- ─── The owner approves one and declines the other ────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a0","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.follow_requests WHERE target_profile_id = (SELECT o FROM ids)), 2,
  'the owner sees every request to them');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'follow_request' AND receiver_id = (SELECT o FROM ids)), 2,
  'and each request wrote them a follow_request notification (ONE-107)');

SELECT lives_ok(
  $$SELECT public.approve_follow_request(
      (SELECT id FROM public.follow_requests WHERE requester_profile_id = (SELECT s FROM ids)))$$,
  'the owner approves a request');

SELECT ok(EXISTS (SELECT 1 FROM public.follows f, ids WHERE f.follower_id = ids.s AND f.followed_id = ids.o),
  'approving makes the follow');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.follow_requests fr, ids WHERE fr.requester_profile_id = ids.s),
  'and removes the request');

SELECT lives_ok(
  $$DELETE FROM public.follow_requests WHERE requester_profile_id = (SELECT r FROM ids)$$,
  'the owner declines a request');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.follow_requests fr, ids WHERE fr.requester_profile_id = ids.r)
  AND NOT EXISTS (SELECT 1 FROM public.follows f, ids WHERE f.follower_id = ids.r AND f.followed_id = ids.o),
  'declining leaves neither a request nor a follow');

SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'follow_request' AND receiver_id = (SELECT o FROM ids)), 0,
  'settling both requests took their notifications with them (ONE-107)');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE type = 'follow' AND receiver_id = (SELECT o FROM ids)), 0,
  'and approving didn''t tell the owner someone started following them');
SELECT throws_ok(
  $$INSERT INTO public.notifications (sender_id, receiver_id, type) SELECT o, s, 'follow_request' FROM ids$$,
  '42501', NULL, 'nobody writes a notification directly (ONE-107)');

-- ─── The approved follower sees the posts, and can't ask again ────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.posts WHERE user_id = (SELECT o FROM ids)), 1,
  'once approved, the requester sees the posts');

SELECT throws_ok(
  $$INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT s, o FROM ids$$,
  '42501', NULL, 'a follower doesn''t ask to follow');

-- ─── The requester cancels ────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a2","role":"authenticated"}', true);
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT r, o FROM ids;
DELETE FROM public.follow_requests WHERE requester_profile_id = (SELECT r FROM ids);
SELECT is((SELECT count(*)::int FROM public.follow_requests), 0,
  'the requester cancels their request');

-- ─── Going public lets everyone pending in ────────────────────────────

INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT r, o FROM ids;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a3","role":"authenticated"}', true);
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT t, o FROM ids;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000063a0","role":"authenticated"}', true);
UPDATE public.profiles SET is_private = false WHERE id = (SELECT o FROM ids);

SELECT is(
  (SELECT count(*)::int FROM public.follows f, ids WHERE f.followed_id = ids.o AND f.follower_id IN (ids.r, ids.t)),
  2, 'going public turns each pending request into a follow');
SELECT is((SELECT count(*)::int FROM public.follow_requests WHERE target_profile_id = (SELECT o FROM ids)), 0,
  'and leaves no request behind');

-- ─── Who may call approve ─────────────────────────────────────────────

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.approve_follow_request(uuid)', 'EXECUTE'),
  'anon cannot execute approve_follow_request()');
SELECT ok(NOT has_function_privilege('authenticated', 'public.promote_follow_requests()', 'EXECUTE'),
  'nobody calls promote_follow_requests() but its trigger');

SELECT * FROM finish();
ROLLBACK;
