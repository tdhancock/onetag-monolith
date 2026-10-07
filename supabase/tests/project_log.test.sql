-- Project log: dated entries of what was done, and who did it (ONE-141). Runs
-- against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A owns public PUB, private PRIV (Contributor CI) and unlisted U (tag
-- LGUNLS23). Account B holds business BB, named as who did the work. Account C
-- is PRIV's Contributor; account D is a stranger.

BEGIN;
SELECT plan(39);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000141', 'a@one141.test', '{"username":"one141_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000141', 'b@one141.test', '{"username":"one141_b"}'),
  ('cccccccc-0000-0000-0000-000000000141', 'c@one141.test', '{"username":"one141_c"}'),
  ('dddddddd-0000-0000-0000-000000000141', 'd@one141.test', '{"username":"one141_d"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('bbbbbbbb-0000-0000-0000-000000000141', 'business', 'one141_b_hvac', 'B Heating');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one141_b_hvac';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one141_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one141_b_hvac') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one141_c') AS ci,
  (SELECT id FROM public.profiles WHERE username = 'one141_d') AS di,
  '11111111-0000-0000-0000-0000000001a1'::uuid AS pub,
  '11111111-0000-0000-0000-0000000001a2'::uuid AS priv,
  '11111111-0000-0000-0000-0000000001a3'::uuid AS u,
  '11111111-0000-0000-0000-0000000001e1'::uuid AS e1,
  '11111111-0000-0000-0000-0000000001e2'::uuid AS e2,
  '11111111-0000-0000-0000-0000000001e3'::uuid AS e3,
  '11111111-0000-0000-0000-0000000001e4'::uuid AS e4;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.projects (id, owner_profile_id, name, is_public, unlisted) VALUES
  ((SELECT pub FROM ids), (SELECT ai FROM ids), 'Kitchen', true, false),
  ((SELECT priv FROM ids), (SELECT ai FROM ids), 'Furnace', false, false),
  ((SELECT u FROM ids), (SELECT ai FROM ids), 'Water heater', false, true);
INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT priv FROM ids), (SELECT ci FROM ids));
INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code, dest_project_id)
VALUES ((SELECT ai FROM ids), 'physical', 'qr', 'LGUNLS23', (SELECT u FROM ids));

-- ─── As account A, the owner ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000141","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.project_log_entries
      (id, project_id, occurred_on, title, notes, cost_cents, currency, performed_by_profile_id, updated_at) VALUES
      ((SELECT e1 FROM ids), (SELECT pub FROM ids), '2026-03-12', 'Replaced the igniter', 'Under warranty', 18000, 'USD',
       (SELECT bb FROM ids), '2020-01-01')$$,
  'the owner logs an entry, naming who did it');
SELECT lives_ok(
  $$INSERT INTO public.project_log_entries (id, project_id, occurred_on, title, performed_by_profile_id) VALUES
      ((SELECT e2 FROM ids), (SELECT priv FROM ids), '2026-01-05', 'Annual service', (SELECT bb FROM ids)),
      ((SELECT e3 FROM ids), (SELECT u FROM ids), '2026-02-01', 'Flushed the tank', NULL),
      ((SELECT e4 FROM ids), (SELECT pub FROM ids), '2026-04-01', 'Painted', NULL)$$,
  'on a private and an unlisted project too, with or without a name');

SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title) VALUES ((SELECT pub FROM ids), '2026-03-12', '  ')$$,
  '23514', NULL, 'an entry needs a title');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title) VALUES ((SELECT pub FROM ids), '2026-03-12', repeat('x', 81))$$,
  '23514', NULL, 'of at most 80 characters');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, notes) VALUES ((SELECT pub FROM ids), '2026-03-12', 'Notes', repeat('x', 2001))$$,
  '23514', NULL, 'notes are at most 2000 characters');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, cost_cents) VALUES ((SELECT pub FROM ids), '2026-03-12', 'Refund', -1)$$,
  '23514', NULL, 'a cost is never negative');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, cost_cents, currency) VALUES ((SELECT pub FROM ids), '2026-03-12', 'Parts', 100, 'usd')$$,
  '23514', NULL, 'a currency is ISO 4217, as a product''s is');

UPDATE public.project_log_entries SET notes = 'Under warranty, no charge' WHERE id = (SELECT e1 FROM ids);
SELECT ok((SELECT updated_at > '2020-01-02' FROM public.project_log_entries WHERE id = (SELECT e1 FROM ids)),
  'an update is stamped by the database');

-- Four photos an entry.
SELECT lives_ok(
  $$INSERT INTO public.project_log_media (entry_id, url, sort_order)
    SELECT (SELECT e1 FROM ids), 'https://example.test/' || n || '.jpg', n FROM generate_series(0, 3) n$$,
  'the owner adds four photos to an entry');
SELECT throws_ok(
  $$INSERT INTO public.project_log_media (entry_id, url) VALUES ((SELECT e1 FROM ids), 'https://example.test/5.jpg')$$,
  '23514', NULL, 'and no fifth');
SELECT throws_ok(
  $$INSERT INTO public.project_log_media (entry_id, url, sort_order)
    SELECT (SELECT e2 FROM ids), 'https://example.test/' || n || '.jpg', n FROM generate_series(0, 4) n$$,
  '23514', NULL, 'nor five in one insert');
SELECT lives_ok(
  $$INSERT INTO public.project_log_media (entry_id, url) VALUES ((SELECT e2 FROM ids), 'https://example.test/receipt.jpg')$$,
  'a photo on the private project''s entry');

-- ─── Someone else's name ──────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000141","role":"authenticated"}', true);
SELECT ok(NOT public.remove_me_from_log_entry((SELECT e1 FROM ids)), 'a stranger cannot take B''s name off');

-- ─── As account B, the business named on two entries ──────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000141","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT pub FROM ids)), 2,
  'anyone signed in reads a public project''s log');
SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e1 FROM ids)), 4,
  'and its photos');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title) VALUES ((SELECT pub FROM ids), '2026-05-01', 'Serviced')$$,
  '42501', NULL, 'an account that doesn''t own the project cannot log to it');
SELECT throws_ok(
  $$INSERT INTO public.project_log_media (entry_id, url) VALUES ((SELECT e4 FROM ids), 'https://example.test/x.jpg')$$,
  '42501', NULL, 'nor add a photo to its entries');
UPDATE public.project_log_entries SET title = 'Rewritten' WHERE id = (SELECT e1 FROM ids);
DELETE FROM public.project_log_entries WHERE id = (SELECT e4 FROM ids);
DELETE FROM public.project_log_media WHERE entry_id = (SELECT e1 FROM ids);

SELECT ok(public.remove_me_from_log_entry((SELECT e1 FROM ids)), 'the named business takes its name off an entry');
SELECT ok(NOT public.remove_me_from_log_entry((SELECT e1 FROM ids)), 'and there is nothing left to take off');
SELECT ok(public.remove_me_from_log_entry((SELECT e2 FROM ids)),
  'even on a private project''s entry it cannot read');

-- ─── As account D, a stranger ─────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000141","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT priv FROM ids)), 0,
  'a stranger reads nothing of a private project''s log');
SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e2 FROM ids)), 0,
  'nor its photos');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT u FROM ids)), 0,
  'nor an unlisted one''s before opening its tag');
SELECT ok(public.grant_project_tag_access('LGUNLS23', (SELECT di FROM ids)), 'D opens the unlisted project''s tag');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT u FROM ids)), 1,
  'and then reads its log (ONE-137)');

-- ─── As account C, a Contributor to the private project ───────────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000141","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT priv FROM ids)), 1,
  'a Contributor reads a private project''s log');
SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e2 FROM ids)), 1,
  'and its photos');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title) VALUES ((SELECT priv FROM ids), '2026-05-01', 'Mine')$$,
  '42501', NULL, 'and cannot write as its owner (writing as itself is ONE-143''s)');

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT pub FROM ids)), 2,
  'anon reads a public project''s log');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id IN ((SELECT priv FROM ids), (SELECT u FROM ids))), 0,
  'and nothing of a private or unlisted one''s');
SELECT throws_ok(
  $$SELECT public.remove_me_from_log_entry((SELECT e1 FROM ids))$$,
  '42501', NULL, 'anon cannot call remove_me_from_log_entry()');

-- ─── Back as the owner ────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000141","role":"authenticated"}', true);

SELECT is(
  (SELECT row(title, performed_by_profile_id)::text FROM public.project_log_entries WHERE id = (SELECT e1 FROM ids)),
  row('Replaced the igniter', NULL::uuid)::text,
  'the entry stays, with no one named, and B''s update reached nothing');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE id = (SELECT e4 FROM ids)), 1,
  'B''s delete reached nothing');
SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e1 FROM ids)), 4,
  'nor did its photo delete');

SELECT lives_ok($$UPDATE public.project_log_entries SET performed_by_profile_id = (SELECT bb FROM ids) WHERE id = (SELECT e3 FROM ids)$$,
  'the owner names B on another entry');
SELECT lives_ok($$DELETE FROM public.project_log_entries WHERE id = (SELECT e1 FROM ids)$$, 'and deletes the entry');

RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e1 FROM ids)), 0,
  'its photos go with it');

DELETE FROM public.profiles WHERE id = (SELECT bb FROM ids);
SELECT is(
  (SELECT row(title, performed_by_profile_id)::text FROM public.project_log_entries WHERE id = (SELECT e3 FROM ids)),
  row('Flushed the tank', NULL::uuid)::text,
  'deleting a named profile keeps the entry, naming no one');

DELETE FROM public.projects WHERE id = (SELECT priv FROM ids);
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT priv FROM ids)), 0,
  'deleting a project deletes its log');

SELECT * FROM finish();
ROLLBACK;
