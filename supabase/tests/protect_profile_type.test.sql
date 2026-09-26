-- profile_type is frozen once a profile exists (ONE-79). Runs against a real
-- database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Each account holds a single profile, so profiles_one_per_type has nothing
-- to collide with and only the trigger stands between the owner and a flip.
--
-- Account B: one business profile, with its business row.
-- Account Y: one individual profile (signup trigger).

BEGIN;
SELECT plan(8);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-0000-0000-0000-0000000000a9', 'b@one79.test', '{"username":"one79_b"}'),
  ('22222222-0000-0000-0000-0000000000b9', 'y@one79.test', '{"username":"one79_y"}');

-- Signup gives B an individual profile. The database owner converts it —
-- the one role still allowed to — so B holds only a business profile.
UPDATE public.profiles SET profile_type = 'business' WHERE username = 'one79_b';
INSERT INTO public.business_profiles (profile_id, category)
SELECT id, 'Cafe' FROM public.profiles WHERE username = 'one79_b';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one79_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'one79_y') AS y;
GRANT SELECT ON ids TO authenticated;

-- ─── Act as account B ─────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-0000000000a9","role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.profiles SET profile_type = 'individual' WHERE id = (SELECT b FROM ids)$$,
  '42501', NULL, 'the owner cannot flip business to individual');

WITH u AS (UPDATE public.profiles SET bio = 'Still a studio' WHERE id = (SELECT b FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can still edit the bio of a business profile');

SELECT lives_ok(
  $$UPDATE public.profiles SET profile_type = 'business', full_name = 'B Studio' WHERE id = (SELECT b FROM ids)$$,
  'an update that re-sends the same profile_type succeeds');

-- ─── Act as account Y ─────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-0000000000b9","role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.profiles SET profile_type = 'business' WHERE id = (SELECT y FROM ids)$$,
  '42501', NULL, 'the owner cannot flip individual to business');

WITH u AS (UPDATE public.profiles SET bio = 'Still me' WHERE id = (SELECT y FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can still edit the bio of an individual profile');

-- ─── As the database owner ────────────────────────────────────────────

RESET ROLE;

SELECT is(
  (SELECT array_agg(profile_type ORDER BY username) FROM public.profiles WHERE id IN ((SELECT b FROM ids), (SELECT y FROM ids))),
  ARRAY['business', 'individual'], 'the rejected flips left both profiles as they were');

SELECT lives_ok(
  $$UPDATE public.profiles SET profile_type = 'business' WHERE id = (SELECT y FROM ids)$$,
  'after RESET ROLE, the database owner can change profile_type');

SELECT is(
  (SELECT profile_type FROM public.profiles WHERE id = (SELECT y FROM ids)),
  'business', 'and the change stands');

SELECT * FROM finish();
ROLLBACK;
