-- RLS under multi-profile (ONE-21). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. Accounts are created
-- through auth.users, so the signup trigger builds their first profile with a
-- fresh id — which is exactly the case the rewrite exists for: a profile id
-- that is NOT its account's auth id.
--
-- Account X: auth id X, individual profile XA (trigger), business profile XB.
-- Account Y: auth id Y, individual profile YA (trigger).

BEGIN;
SELECT plan(24);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-0000-0000-0000-00000000000a', 'x@one21.test', '{"username":"one21_x"}'),
  ('22222222-0000-0000-0000-00000000000b', 'y@one21.test', '{"username":"one21_y"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE user_id = '11111111-0000-0000-0000-00000000000a') AS xa,
  (SELECT id FROM public.profiles WHERE user_id = '22222222-0000-0000-0000-00000000000b') AS ya;
GRANT SELECT ON ids TO authenticated;

-- ─── 1. Signup ────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = '11111111-0000-0000-0000-00000000000a'),
  1, 'signup creates exactly one profile');
SELECT isnt(
  (SELECT xa FROM ids), '11111111-0000-0000-0000-00000000000a'::uuid,
  'the new profile has a fresh id, not the auth user id');
SELECT is(
  (SELECT profile_type FROM public.profiles WHERE id = (SELECT xa FROM ids)),
  'individual', 'the new profile is an Individual Profile');

-- ─── 2. One profile of each type per account ──────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username)
    VALUES ('11111111-0000-0000-0000-00000000000a', 'individual', 'one21_x_second')$$,
  '23505', NULL, 'a second individual profile for the same account is rejected');

SELECT lives_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username)
    VALUES ('11111111-0000-0000-0000-00000000000a', 'business', 'one21_x_biz')$$,
  'a business profile alongside the individual one is accepted');

ALTER TABLE ids ADD COLUMN xb UUID;
UPDATE ids SET xb = (SELECT id FROM public.profiles WHERE username = 'one21_x_biz');

-- ─── Act as account X ─────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT ok(public.owns_profile((SELECT xa FROM ids)), 'X owns its individual profile');
SELECT ok(public.owns_profile((SELECT xb FROM ids)), 'X owns its business profile');
SELECT ok(NOT public.owns_profile((SELECT ya FROM ids)), 'X does not own Y''s profile');

-- ─── 3. Editing profiles ──────────────────────────────────────────────

WITH u AS (UPDATE public.profiles SET bio = 'x edits' WHERE id IN ((SELECT xa FROM ids), (SELECT xb FROM ids)) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 2, 'an account with two profiles can edit both');

WITH u AS (UPDATE public.profiles SET bio = 'hijacked' WHERE id = (SELECT ya FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'an account cannot edit another account''s profile');

SELECT throws_ok(
  $$UPDATE public.profiles SET user_id = '22222222-0000-0000-0000-00000000000b' WHERE id = (SELECT xa FROM ids)$$,
  '42501', NULL, 'a profile cannot be handed to another account');

-- ─── 4. Posts ─────────────────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.posts (user_id, content) VALUES ((SELECT xa FROM ids), 'by XA')$$,
  'X can post as its individual profile');

WITH u AS (UPDATE public.posts SET content = 'edited while acting as XB'
           WHERE user_id = (SELECT xa FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'a post by profile A is editable by its account while acting as profile B');

SELECT throws_ok(
  $$INSERT INTO public.posts (user_id, content) VALUES ((SELECT ya FROM ids), 'forged')$$,
  '42501', NULL, 'an account cannot post as a profile it does not own');

-- ─── 5. Following and messaging across profiles ──────────────────────

SELECT lives_ok(
  $$INSERT INTO public.follows (follower_id, followed_id) VALUES ((SELECT xb FROM ids), (SELECT ya FROM ids))$$,
  'X can follow as its business profile');

SELECT throws_ok(
  $$INSERT INTO public.follows (follower_id, followed_id) VALUES ((SELECT ya FROM ids), (SELECT xa FROM ids))$$,
  '42501', NULL, 'X cannot follow on Y''s behalf');

SELECT lives_ok(
  $$INSERT INTO public.messages (sender_id, receiver_id, text) VALUES ((SELECT xb FROM ids), (SELECT ya FROM ids), 'hi from XB')$$,
  'X can message as its business profile');

-- ─── Act as account Y ─────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE receiver_id = (SELECT ya FROM ids)),
  1, 'Y reads a message sent to its profile');

-- Y blocks X — an account-level block, keyed on auth ids.
SELECT lives_ok(
  $$INSERT INTO public.blocks (blocker_id, blocked_id)
    VALUES ('22222222-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000a')$$,
  'Y can block account X');

INSERT INTO public.posts (user_id, content) VALUES ((SELECT ya FROM ids), 'by YA');

-- ─── 6. A block holds when the sender acts through a fresh-id profile ─

SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.messages (sender_id, receiver_id, text) VALUES ((SELECT xa FROM ids), (SELECT ya FROM ids), 'blocked?')$$,
  '42501', NULL, 'a block rejects a message from the blocked account''s individual profile');

SELECT throws_ok(
  $$INSERT INTO public.messages (sender_id, receiver_id, text) VALUES ((SELECT xb FROM ids), (SELECT ya FROM ids), 'blocked?')$$,
  '42501', NULL, 'a block rejects a message from the blocked account''s business profile');

SELECT throws_ok(
  $$INSERT INTO public.comments (post_id, user_id, content)
    VALUES ((SELECT id FROM public.posts WHERE content = 'by YA'), (SELECT xb FROM ids), 'blocked?')$$,
  '42501', NULL, 'a block rejects a comment from the blocked account');

-- ─── 7. Account-scoped rows stay on the auth id ──────────────────────

SELECT lives_ok(
  $$INSERT INTO public.push_tokens (user_id, token) VALUES ('11111111-0000-0000-0000-00000000000a', 'ExponentPushToken[one21]')$$,
  'a push token registers against the auth user id, which is no profile''s id');

RESET ROLE;

SELECT is(
  public.get_email_by_username('one21_x_biz'), 'x@one21.test',
  'username login resolves through the profile''s account');

SELECT * FROM finish();
ROLLBACK;
