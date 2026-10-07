-- Projects inside a project, one level deep (ONE-134). Runs against a real
-- database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual AI (signup trigger) and business AB; AI owns house H,
-- garage H2 and shed X, and B is Linked to X as a Contributor. Account B:
-- individual BI, owning G.

BEGIN;
SELECT plan(14);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000134', 'a@one134.test', '{"username":"one134_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000134', 'b@one134.test', '{"username":"one134_b"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000134', 'business', 'one134_a_biz', 'A Builders');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one134_a_biz';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one134_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one134_a_biz') AS ab,
  (SELECT id FROM public.profiles WHERE username = 'one134_b') AS bi,
  'dddddddd-0000-0000-0000-0000000001a1'::uuid AS h,
  'dddddddd-0000-0000-0000-0000000001a2'::uuid AS h2,
  'dddddddd-0000-0000-0000-0000000001a3'::uuid AS x,
  'dddddddd-0000-0000-0000-0000000001b1'::uuid AS g,
  'dddddddd-0000-0000-0000-0000000001f1'::uuid AS f;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.projects (id, owner_profile_id, name) VALUES
  ((SELECT h FROM ids), (SELECT ai FROM ids), 'House'),
  ((SELECT h2 FROM ids), (SELECT ai FROM ids), 'Garage'),
  ((SELECT x FROM ids), (SELECT ai FROM ids), 'Shed'),
  ((SELECT g FROM ids), (SELECT bi FROM ids), 'B''s place');
INSERT INTO public.contributors (project_id, contributor_profile_id)
VALUES ((SELECT x FROM ids), (SELECT bi FROM ids));

-- ─── As account A, the owner ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000134","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.projects (id, owner_profile_id, name, parent_project_id)
    VALUES ((SELECT f FROM ids), (SELECT ai FROM ids), 'Furnace', (SELECT h FROM ids))$$,
  'the owner creates a project inside one of their own');

SELECT is(
  (SELECT parent_project_id FROM public.projects WHERE id = (SELECT f FROM ids)),
  (SELECT h FROM ids),
  'the new project sits inside the house');

SELECT throws_ok(
  $$INSERT INTO public.projects (owner_profile_id, name, parent_project_id)
    VALUES ((SELECT ai FROM ids), 'Filter', (SELECT f FROM ids))$$,
  '23514', 'a project inside another cannot hold projects: one level only',
  'nothing goes inside a project that is itself inside another');

SELECT throws_ok(
  $$UPDATE public.projects SET parent_project_id = (SELECT f FROM ids) WHERE id = (SELECT h2 FROM ids)$$,
  '23514', 'a project inside another cannot hold projects: one level only',
  'nor is an existing project moved inside one');

SELECT throws_ok(
  $$UPDATE public.projects SET parent_project_id = (SELECT h2 FROM ids) WHERE id = (SELECT h FROM ids)$$,
  '23514', 'a project with projects inside it cannot sit inside another: one level only',
  'a project holding others cannot go inside another');

SELECT throws_ok(
  $$UPDATE public.projects SET parent_project_id = (SELECT h2 FROM ids) WHERE id = (SELECT h2 FROM ids)$$,
  '23514', 'a project cannot sit inside itself',
  'a project cannot sit inside itself');

SELECT throws_ok(
  $$UPDATE public.projects SET owner_profile_id = (SELECT ab FROM ids) WHERE id = (SELECT h FROM ids)$$,
  '23514', 'a project with projects inside it cannot change owner',
  'a project holding others keeps its owner, even another profile of the same account');

SELECT lives_ok(
  $$UPDATE public.projects SET parent_project_id = NULL WHERE id = (SELECT f FROM ids)$$,
  'the owner moves a project out of the house');

SELECT lives_ok(
  $$UPDATE public.projects SET parent_project_id = (SELECT h FROM ids) WHERE id = (SELECT f FROM ids)$$,
  'and back in');

-- ─── As account B ─────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000134","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.projects (owner_profile_id, name, parent_project_id)
    VALUES ((SELECT bi FROM ids), 'Squatter', (SELECT h FROM ids))$$,
  '23514', 'a project can only sit inside a project with the same owner',
  'another account cannot create a project inside A''s house');

SELECT throws_ok(
  $$UPDATE public.projects SET parent_project_id = (SELECT h FROM ids) WHERE id = (SELECT g FROM ids)$$,
  '23514', 'a project can only sit inside a project with the same owner',
  'nor move its own project inside A''s');

WITH u AS (
  UPDATE public.projects SET parent_project_id = (SELECT h FROM ids) WHERE id = (SELECT x FROM ids) RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 0, 'a Contributor cannot move the project they contribute to');

-- ─── Deleting the house ───────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000134","role":"authenticated"}', true);

WITH d AS (DELETE FROM public.projects WHERE id = (SELECT h FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 1, 'the owner deletes the house');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = (SELECT f FROM ids)),
  0, 'and what was inside it goes with it');

SELECT * FROM finish();
ROLLBACK;
