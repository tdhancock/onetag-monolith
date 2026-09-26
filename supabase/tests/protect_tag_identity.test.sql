-- A tag's short code, destination, type and owner are frozen once it exists
-- (ONE-86). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A holds two profiles: individual AI (signup trigger) and business
-- AB. Tag T belongs to AI and points at AI. Every refused change below is one
-- RLS would allow — A owns both profiles — so only the trigger refuses it.

BEGIN;
SELECT plan(12);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000086', 'a@one86.test', '{"username":"one86_a"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000086', 'business', 'one86_a_studio', 'A Studio');
INSERT INTO public.business_profiles (profile_id, category)
SELECT id, 'Cafe' FROM public.profiles WHERE username = 'one86_a_studio';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one86_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one86_a_studio') AS ab,
  'dddddddd-0000-0000-0000-000000000086'::uuid AS t,
  'dddddddd-0000-0000-0000-0000000000f6'::uuid AS pj;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.projects (id, owner_profile_id, name)
VALUES ((SELECT pj FROM ids), (SELECT ai FROM ids), 'A''s own project');

INSERT INTO public.tags (id, owner_profile_id, tag_type, format, name, dest_profile_id)
VALUES ((SELECT t FROM ids), (SELECT ai FROM ids), 'physical', 'qr', 'Front door', (SELECT ai FROM ids));

CREATE TEMP TABLE original ON COMMIT DROP AS
SELECT short_code FROM public.tags WHERE id = (SELECT t FROM ids);
GRANT SELECT ON original TO authenticated;

-- ─── Act as account A ─────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000086","role":"authenticated"}', true);

WITH u AS (
  UPDATE public.tags SET name = 'Back door', note = 'By the bell' WHERE id = (SELECT t FROM ids) RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can still rename a tag and change its note');

WITH u AS (UPDATE public.tags SET active = false WHERE id = (SELECT t FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can still pause a tag');

WITH u AS (UPDATE public.tags SET active = true WHERE id = (SELECT t FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'and resume it');

SELECT throws_ok(
  $$UPDATE public.tags SET short_code = 'ZZZZ2345' WHERE id = (SELECT t FROM ids)$$,
  '42501', NULL, 'the owner cannot change the short code');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_profile_id = (SELECT ab FROM ids) WHERE id = (SELECT t FROM ids)$$,
  '42501', NULL, 'the owner cannot repoint the tag, even at another profile the account owns');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_profile_id = NULL, dest_project_id = (SELECT pj FROM ids) WHERE id = (SELECT t FROM ids)$$,
  '42501', NULL, 'the owner cannot repoint the tag at a project the account owns either (ONE-38)');

SELECT throws_ok(
  $$UPDATE public.tags SET tag_type = 'digital', format = NULL WHERE id = (SELECT t FROM ids)$$,
  '42501', NULL, 'the owner cannot change the tag type');

SELECT throws_ok(
  $$UPDATE public.tags SET owner_profile_id = (SELECT ab FROM ids) WHERE id = (SELECT t FROM ids)$$,
  '42501', NULL, 'the owner cannot move the tag to another profile the account owns');

SELECT lives_ok(
  $$UPDATE public.tags
    SET short_code = (SELECT short_code FROM original),
        dest_profile_id = (SELECT ai FROM ids),
        tag_type = 'physical',
        owner_profile_id = (SELECT ai FROM ids),
        name = 'Side door'
    WHERE id = (SELECT t FROM ids)$$,
  'an update that re-sends the frozen columns unchanged succeeds');

-- ─── As the database owner ────────────────────────────────────────────

RESET ROLE;

SELECT is(
  (SELECT row(short_code, dest_profile_id, tag_type, owner_profile_id)::text FROM public.tags WHERE id = (SELECT t FROM ids)),
  (SELECT row((SELECT short_code FROM original), (SELECT ai FROM ids), 'physical', (SELECT ai FROM ids))::text),
  'the refused changes left the tag as it was');

SELECT lives_ok(
  $$UPDATE public.tags SET dest_profile_id = (SELECT ab FROM ids) WHERE id = (SELECT t FROM ids)$$,
  'the database owner can still change a frozen column');

SELECT is(
  (SELECT dest_profile_id FROM public.tags WHERE id = (SELECT t FROM ids)),
  (SELECT ab FROM ids), 'and the change stands');

SELECT * FROM finish();
ROLLBACK;
