-- create_profile: a profile and its business row in one transaction (ONE-80).
-- Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account X: individual profile XA (signup trigger), then a business profile
-- created through the function.
-- Account Y: individual profile YA (signup trigger), holding the handle X
-- tries to take.
-- Account Z: individual profile ZA (signup trigger), whose business profile
-- fails halfway.

BEGIN;
SELECT plan(11);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-0000-0000-0000-0000000000c1', 'x@one80.test', '{"username":"one80_x"}'),
  ('22222222-0000-0000-0000-0000000000c2', 'y@one80.test', '{"username":"one80_y"}'),
  ('33333333-0000-0000-0000-0000000000c3', 'z@one80.test', '{"username":"one80_z"}');

-- ─── Act as account X ─────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

SELECT is(
  (SELECT user_id FROM public.create_profile('business', 'one80_x_biz', 'X Studio', 'Ceramics.')),
  '11111111-0000-0000-0000-0000000000c1'::uuid,
  'the new profile belongs to the calling account');

SELECT is(
  (SELECT count(*)::int FROM public.profiles p JOIN public.business_profiles b ON b.profile_id = p.id
   WHERE p.username = 'one80_x_biz' AND p.profile_type = 'business' AND p.bio = 'Ceramics.'),
  1, 'one call creates a business profile and its business row');

SELECT throws_ok(
  $$SELECT public.create_profile('business', 'one80_x_biz2', 'Again')$$,
  '23505', 'duplicate key value violates unique constraint "profiles_one_per_type"',
  'a second business profile raises 23505 naming profiles_one_per_type');

SELECT throws_ok(
  $$SELECT public.create_profile('business', 'ONE80_Y', 'Copycat')$$,
  '23505', 'duplicate key value violates unique constraint "profiles_username_lower_key"',
  'a duplicate handle raises 23505 naming profiles_username_lower_key');

-- ─── Act as account Y ─────────────────────────────────────────────────
--
-- Creating an individual profile needs an account without one, which signup
-- never leaves. The database owner — the one role ONE-79 still lets change a
-- type — converts Y's signup profile to business first.

RESET ROLE;
UPDATE public.profiles SET profile_type = 'business' WHERE username = 'one80_y';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-0000000000c2","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.create_profile('individual', 'one80_y_ind', 'Y')$$,
  'an account can create an individual profile through the function');

SELECT is(
  (SELECT count(*)::int FROM public.business_profiles b JOIN public.profiles p ON p.id = b.profile_id
   WHERE p.username = 'one80_y_ind'),
  0, 'an individual profile gets no business row');

-- ─── Act as account Z: the second insert fails ────────────────────────
--
-- Revoking the business_profiles insert makes the function's second
-- statement fail. The revoke rolls back with the test.

RESET ROLE;
REVOKE INSERT ON public.business_profiles FROM authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"33333333-0000-0000-0000-0000000000c3","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.create_profile('business', 'one80_z_biz', 'Z Works')$$,
  '42501', NULL, 'the function raises when the business insert fails');

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE username = 'one80_z_biz'),
  0, 'a failed second insert leaves nothing behind');

-- ─── No session ───────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.create_profile('individual', 'one80_nobody', 'Nobody')$$,
  '42501', 'create_profile needs a signed-in account',
  'the function refuses a caller with no auth.uid()');

-- ─── Anonymous ────────────────────────────────────────────────────────

RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.create_profile(text, text, text, text)', 'EXECUTE'),
  'anon holds no execute grant on the function');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$SELECT public.create_profile('individual', 'one80_anon', 'Anon')$$,
  '42501', NULL, 'anon cannot execute the function');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
