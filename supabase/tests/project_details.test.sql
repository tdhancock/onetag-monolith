-- Project details: facts the owner defines (ONE-140). Runs against a real
-- database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A owns public PUB, private PRIV (Contributor C) and unlisted U (tag
-- DTLSUN23). Account B is a stranger until it opens U's tag.

BEGIN;
SELECT plan(32);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000140', 'a@one140.test', '{"username":"one140_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000140', 'b@one140.test', '{"username":"one140_b"}'),
  ('cccccccc-0000-0000-0000-000000000140', 'c@one140.test', '{"username":"one140_c"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one140_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one140_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one140_c') AS ci,
  'ffffffff-0000-0000-0000-0000000001a1'::uuid AS pub,
  'ffffffff-0000-0000-0000-0000000001a2'::uuid AS priv,
  'ffffffff-0000-0000-0000-0000000001a3'::uuid AS u,
  'ffffffff-0000-0000-0000-0000000001d1'::uuid AS d1,
  'ffffffff-0000-0000-0000-0000000001d2'::uuid AS d2;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.projects (id, owner_profile_id, name, is_public, unlisted) VALUES
  ((SELECT pub FROM ids), (SELECT ai FROM ids), 'Kitchen', true, false),
  ((SELECT priv FROM ids), (SELECT ai FROM ids), 'Safe', false, false),
  ((SELECT u FROM ids), (SELECT ai FROM ids), 'Furnace', false, true);
INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT priv FROM ids), (SELECT ci FROM ids));
INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code, dest_project_id)
VALUES ((SELECT ai FROM ids), 'physical', 'qr', 'DTLSUN23', (SELECT u FROM ids));

-- ─── As account A, the owner ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000140","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.project_details (id, project_id, label, kind, value, sort_order) VALUES
      ((SELECT d1 FROM ids), (SELECT pub FROM ids), 'Model number', 'text', 'XR-200', 0),
      ((SELECT d2 FROM ids), (SELECT pub FROM ids), 'Capacity (gal)', 'number', '-40.5', 1),
      (gen_random_uuid(), (SELECT pub FROM ids), 'Installed', 'date', '2028-02-29', 2),
      (gen_random_uuid(), (SELECT pub FROM ids), 'Manual', 'link', 'https://example.test/manual.pdf', 3)$$,
  'the owner adds a detail of each kind');

SELECT lives_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES
      ((SELECT priv FROM ids), 'Combination', 'text', 'Kept elsewhere'),
      ((SELECT u FROM ids), 'Filter size', 'text', '16x25x1')$$,
  'and on a private and an unlisted project');

-- Every value is checked against its kind.
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Installed', 'date', '2026-02-30')$$,
  '23514', NULL, 'a date that does not exist is refused: 2026-02-30');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Installed', 'date', '2027-02-29')$$,
  '23514', NULL, 'and the 29th of February outside a leap year');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Installed', 'date', '2026-2-3')$$,
  '23514', NULL, 'a date is YYYY-MM-DD');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Installed', 'date', '2026-13-01')$$,
  '23514', NULL, 'with a month that exists');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Year built', 'number', '12a')$$,
  '23514', NULL, 'a number is digits');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Year built', 'number', '1.')$$,
  '23514', NULL, 'with digits after any point');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Manual', 'link', 'www.example.test')$$,
  '23514', NULL, 'a link starts with http:// or https://');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Manual', 'link', 'ftp://example.test')$$,
  '23514', NULL, 'and no other scheme');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Colour', 'colour', 'Red')$$,
  '23514', NULL, 'a kind is text, number, date or link');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), '   ', 'text', 'Red')$$,
  '23514', NULL, 'a label is not blank');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), repeat('x', 41), 'text', 'Red')$$,
  '23514', NULL, 'a label is at most 40 characters');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Colour', 'text', '  ')$$,
  '23514', NULL, 'an empty value is never saved');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Notes', 'text', repeat('x', 501))$$,
  '23514', NULL, 'a value is at most 500 characters');

SELECT lives_ok(
  $$UPDATE public.project_details SET sort_order = 5, value = 'XR-300' WHERE id = (SELECT d1 FROM ids)$$,
  'the owner changes and moves a detail');
SELECT is(
  (SELECT row(value, sort_order)::text FROM public.project_details WHERE id = (SELECT d1 FROM ids)),
  row('XR-300', 5)::text, 'and it is changed');

-- ─── As account B, a stranger ─────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000140","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT pub FROM ids)), 4,
  'a stranger reads a public project''s details');
SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT priv FROM ids)), 0,
  'and none of a private project''s');
SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT u FROM ids)), 0,
  'and none of an unlisted one''s before opening its tag');

SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT pub FROM ids), 'Sneaky', 'text', 'x')$$,
  '42501', NULL, 'a stranger cannot add a detail to someone else''s project');
UPDATE public.project_details SET value = 'Changed' WHERE id = (SELECT d2 FROM ids);
DELETE FROM public.project_details WHERE id = (SELECT d1 FROM ids);

SELECT ok(public.grant_project_tag_access('DTLSUN23', (SELECT bi FROM ids)), 'B opens the unlisted project''s tag');
SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT u FROM ids)), 1,
  'and then reads its details (ONE-137)');

-- ─── As account C, a Contributor to the private project ───────────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000140","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT priv FROM ids)), 1,
  'a Contributor reads a private project''s details');
SELECT throws_ok(
  $$INSERT INTO public.project_details (project_id, label, kind, value) VALUES ((SELECT priv FROM ids), 'Mine', 'text', 'x')$$,
  '42501', NULL, 'but only its owner writes them');

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT pub FROM ids)), 4,
  'anon reads a public project''s details');
SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id IN ((SELECT priv FROM ids), (SELECT u FROM ids))), 0,
  'and none of a private or unlisted one''s');

-- ─── Back as the owner ────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000140","role":"authenticated"}', true);

SELECT is(
  (SELECT row(value, sort_order)::text FROM public.project_details WHERE id = (SELECT d1 FROM ids)),
  row('XR-300', 5)::text, 'the stranger''s delete reached nothing');
SELECT is((SELECT value FROM public.project_details WHERE id = (SELECT d2 FROM ids)), '-40.5',
  'and their update changed nothing');

SELECT lives_ok($$DELETE FROM public.project_details WHERE id = (SELECT d2 FROM ids)$$, 'the owner removes a detail');
SELECT lives_ok($$DELETE FROM public.projects WHERE id = (SELECT pub FROM ids)$$, 'and deletes the project');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.project_details WHERE project_id = (SELECT pub FROM ids)), 0,
  'its details go with it');

SELECT * FROM finish();
ROLLBACK;
