-- Business Profile fields (ONE-23). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account X: individual profile XA (signup trigger), business profile XB.
-- Account Y: individual profile YA (signup trigger).

BEGIN;
SELECT plan(18);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-0000-0000-0000-0000000000a3', 'x@one23.test', '{"username":"one23_x"}'),
  ('22222222-0000-0000-0000-0000000000b3', 'y@one23.test', '{"username":"one23_y"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('11111111-0000-0000-0000-0000000000a3', 'business', 'one23_x_biz', 'X Studio');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one23_x') AS xa,
  (SELECT id FROM public.profiles WHERE username = 'one23_x_biz') AS xb,
  (SELECT id FROM public.profiles WHERE username = 'one23_y') AS ya;
GRANT SELECT ON ids TO authenticated, anon;

-- ─── Act as account X ─────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

-- ─── 1. The type guard ────────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.business_profiles (profile_id, category) VALUES ((SELECT xa FROM ids), 'Cafe')$$,
  '23514', NULL, 'a business row for an individual profile is rejected');

SELECT lives_ok(
  $$INSERT INTO public.business_profiles (profile_id, category, website, location)
    VALUES ((SELECT xb FROM ids), 'Cafe', 'https://x.example', 'Austin, TX')$$,
  'the owner can add business fields to its business profile');

SELECT throws_ok(
  $$INSERT INTO public.business_profiles (profile_id) VALUES ((SELECT xb FROM ids))$$,
  '23505', NULL, 'a profile has at most one business row');

SELECT throws_ok(
  $$UPDATE public.business_profiles SET profile_id = (SELECT xa FROM ids) WHERE profile_id = (SELECT xb FROM ids)$$,
  '23514', NULL, 'a business row cannot be re-pointed at an individual profile');

-- ─── 2. The website is a web link ─────────────────────────────────────

SELECT throws_ok(
  $$UPDATE public.business_profiles SET website = 'x.example' WHERE profile_id = (SELECT xb FROM ids)$$,
  '23514', NULL, 'a website without a scheme is rejected');

SELECT throws_ok(
  $$UPDATE public.business_profiles SET website = 'javascript:alert(1)' WHERE profile_id = (SELECT xb FROM ids)$$,
  '23514', NULL, 'a non-web website is rejected');

-- ─── 3. The owner edits ───────────────────────────────────────────────

WITH u AS (UPDATE public.business_profiles SET category = 'Bakery'
           WHERE profile_id = (SELECT xb FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can update the category');

-- ─── Act as account Y ─────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-0000000000b3","role":"authenticated"}', true);

WITH u AS (UPDATE public.business_profiles SET category = 'hijacked'
           WHERE profile_id = (SELECT xb FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'another account cannot update the category');

WITH d AS (DELETE FROM public.business_profiles WHERE profile_id = (SELECT xb FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'another account cannot delete the business fields');

SELECT is(
  (SELECT category FROM public.business_profiles WHERE profile_id = (SELECT xb FROM ids)),
  'Bakery', 'other accounts read business fields, and the owner''s edit stands');

-- ─── 4. Adding a business profile, as the app does it (ONE-26) ───────
--
-- Y holds only its individual profile. The create flow inserts the profile
-- row and then its business row, both as Y, under RLS.

SELECT lives_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username, full_name)
    VALUES ('22222222-0000-0000-0000-0000000000b3', 'business', 'one26_y_biz', 'Y Works')$$,
  'an account can add a business profile to itself');

SELECT lives_ok(
  $$INSERT INTO public.business_profiles (profile_id)
    VALUES ((SELECT id FROM public.profiles WHERE username = 'one26_y_biz'))$$,
  'and its business row, in the same flow');

SELECT is(
  (SELECT count(*)::int FROM public.profiles p JOIN public.business_profiles b ON b.profile_id = p.id
   WHERE p.username = 'one26_y_biz'),
  1, 'a created business profile has both its profiles row and its business row');

SELECT throws_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username, full_name)
    VALUES ('22222222-0000-0000-0000-0000000000b3', 'business', 'one26_y_biz2', 'Again')$$,
  '23505', NULL, 'a second business profile for the same account hits the one-of-each index');

SELECT throws_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username, full_name)
    VALUES ('22222222-0000-0000-0000-0000000000b3', 'business', 'ONE23_X_BIZ', 'Copycat')$$,
  '23505', NULL, 'a handle already held, in any case, hits the handle index');

SELECT throws_ok(
  $$INSERT INTO public.profiles (user_id, profile_type, username, full_name)
    VALUES ('11111111-0000-0000-0000-0000000000a3', 'business', 'one26_forged', 'Forged')$$,
  '42501', NULL, 'an account cannot add a profile to another account');

-- ─── Read without signing in ──────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT location FROM public.business_profiles WHERE profile_id = (SELECT xb FROM ids)),
  'Austin, TX', 'business fields are readable without signing in');

SELECT throws_ok(
  $$INSERT INTO public.business_profiles (profile_id) VALUES ((SELECT xb FROM ids))$$,
  '42501', NULL, 'an anonymous caller cannot write business fields');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
