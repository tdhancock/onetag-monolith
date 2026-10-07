-- Unlisted projects: readable by whoever holds their tag (ONE-137). Runs
-- against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A owns: unlisted U (tag UNLSTD23, Contributor C), unlisted house H
-- (tag HMEHME23) holding unlisted F and private P, public PUB (tag PUBL2345),
-- private PRIV (tag PRVT2345), and an embedded tag on its post pointing at U.
-- Account B holds no grant until it opens a tag; account D never does.

BEGIN;
SELECT plan(24);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000137', 'a@one137.test', '{"username":"one137_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000137', 'b@one137.test', '{"username":"one137_b"}'),
  ('cccccccc-0000-0000-0000-000000000137', 'c@one137.test', '{"username":"one137_c"}'),
  ('dddddddd-0000-0000-0000-000000000137', 'd@one137.test', '{"username":"one137_d"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one137_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one137_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one137_c') AS ci,
  'eeeeeeee-0000-0000-0000-0000000001a1'::uuid AS u,
  'eeeeeeee-0000-0000-0000-0000000001a2'::uuid AS h,
  'eeeeeeee-0000-0000-0000-0000000001a3'::uuid AS f,
  'eeeeeeee-0000-0000-0000-0000000001a4'::uuid AS p,
  'eeeeeeee-0000-0000-0000-0000000001a5'::uuid AS pub,
  'eeeeeeee-0000-0000-0000-0000000001a6'::uuid AS priv,
  'eeeeeeee-0000-0000-0000-0000000001c1'::uuid AS post;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.projects (id, owner_profile_id, name, is_public, unlisted) VALUES
  ((SELECT u FROM ids), (SELECT ai FROM ids), 'Water heater', false, true),
  ((SELECT h FROM ids), (SELECT ai FROM ids), 'House', false, true),
  ((SELECT pub FROM ids), (SELECT ai FROM ids), 'Kitchen', true, false),
  ((SELECT priv FROM ids), (SELECT ai FROM ids), 'Safe', false, false);
INSERT INTO public.projects (id, owner_profile_id, name, is_public, unlisted, parent_project_id) VALUES
  ((SELECT f FROM ids), (SELECT ai FROM ids), 'Furnace', false, true, (SELECT h FROM ids)),
  ((SELECT p FROM ids), (SELECT ai FROM ids), 'Gun cabinet', false, false, (SELECT h FROM ids));
INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT u FROM ids), (SELECT ci FROM ids));

INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code, dest_project_id) VALUES
  ((SELECT ai FROM ids), 'physical', 'qr', 'UNLSTD23', (SELECT u FROM ids)),
  ((SELECT ai FROM ids), 'physical', 'qr', 'HMEHME23', (SELECT h FROM ids)),
  ((SELECT ai FROM ids), 'physical', 'qr', 'PUBL2345', (SELECT pub FROM ids)),
  ((SELECT ai FROM ids), 'physical', 'qr', 'PRVT2345', (SELECT priv FROM ids));
INSERT INTO public.posts (id, user_id, image_url, media_type)
SELECT post, ai, 'https://example.test/u.jpg', 'image' FROM ids;
INSERT INTO public.tags (owner_profile_id, tag_type, short_code, host_post_id, tag_x_pct, tag_y_pct, dest_project_id)
VALUES ((SELECT ai FROM ids), 'embedded', 'EMBD2345', (SELECT post FROM ids), 50, 50, (SELECT u FROM ids));

SELECT throws_ok(
  $$INSERT INTO public.projects (owner_profile_id, name, is_public, unlisted) VALUES ((SELECT ai FROM ids), 'Both', true, true)$$,
  '23514', NULL, 'a project is never both public and unlisted');

SELECT is(
  (SELECT row(dest_project_unlisted, linked)::text FROM public.resolve_tag('UNLSTD23')),
  row(true, true)::text,
  'resolve_tag says an unlisted project destination is unlisted');

SELECT is(
  (SELECT dest_project_unlisted FROM public.resolve_tag('PUBL2345')),
  false, 'and a public one is not');

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE unlisted), 0, 'anon reads no unlisted project');

RESET ROLE;

-- ─── As account B ─────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000137","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE unlisted), 0, 'without a grant, a signed-in account reads none');

SELECT is(public.grant_project_tag_access('UNLSTD23', (SELECT bi FROM ids)), true, 'opening the tag records a grant');
SELECT is(public.grant_project_tag_access('UNLSTD23', (SELECT bi FROM ids)), true, 'opening it again changes nothing');

SELECT is(
  ARRAY(SELECT id FROM public.projects WHERE unlisted ORDER BY id),
  ARRAY[(SELECT u FROM ids)],
  'with the grant, select * from projects returns that unlisted project and no other');

SELECT is(
  (SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT u FROM ids)),
  1, 'what is read with the project follows it: its Contributors');

SELECT is(public.grant_project_tag_access('PUBL2345', (SELECT bi FROM ids)), false, 'no grant for a public project');
SELECT is(public.grant_project_tag_access('PRVT2345', (SELECT bi FROM ids)), false, 'no grant for a private project');
SELECT is(public.grant_project_tag_access('EMBD2345', (SELECT bi FROM ids)), false, 'no grant through an Embedded Tag');
SELECT is(public.grant_project_tag_access('UNLSTD23', (SELECT ai FROM ids)), false, 'no grant for someone else''s profile');

SELECT is(public.grant_project_tag_access('HMEHME23', (SELECT bi FROM ids)), true, 'opening the house''s tag records a grant');
SELECT ok(
  EXISTS (SELECT 1 FROM public.projects WHERE id = (SELECT f FROM ids)),
  'the house''s grant reads the unlisted project inside it');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.projects WHERE id = (SELECT p FROM ids)),
  'but never a private one');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.project_tag_grants WHERE profile_id = (SELECT bi FROM ids)),
  2, 'one grant a tag, however often it was opened');

UPDATE public.tags SET active = false WHERE short_code = 'UNLSTD23';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000137","role":"authenticated"}', true);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.projects WHERE id = (SELECT u FROM ids)),
  'pausing the tag ends the access');
SELECT is(public.grant_project_tag_access('UNLSTD23', (SELECT bi FROM ids)), false, 'and a paused tag grants nothing');

-- ─── Owners and Contributors, as before ───────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000137","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE owner_profile_id = (SELECT ai FROM ids)),
  6, 'the owner reads every one of their projects, unlisted and private included');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000137","role":"authenticated"}', true);

SELECT ok(
  EXISTS (SELECT 1 FROM public.projects WHERE id = (SELECT u FROM ids)),
  'a Contributor reads an unlisted project with no grant, as for a private one');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000137","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE unlisted), 0, 'an account that never opened a tag reads none');

RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.grant_project_tag_access(text, uuid)', 'EXECUTE'),
  'anon cannot record a grant');
SELECT ok(
  NOT has_function_privilege('anon', 'public.can_read_unlisted_project(uuid)', 'EXECUTE'),
  'anon cannot ask the read test');

SELECT * FROM finish();
ROLLBACK;
