-- Contributors write to a project's log, and businesses who scanned it propose
-- entries (ONE-143). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A owns public project P, with an active tag LGPTAG23 and a paused
-- one LGPOFF23. Business BB (account B) is Linked to P as a Contributor.
-- Account C's individual profile scanned P's active tag, so its business CB
-- may propose. Business DB (account D) never scanned. Account E is an
-- individual who scanned. Business FB's account (F) scanned only the paused tag.

BEGIN;
SELECT plan(48);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000143', 'a@one143.test', '{"username":"one143_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000143', 'b@one143.test', '{"username":"one143_b"}'),
  ('cccccccc-0000-0000-0000-000000000143', 'c@one143.test', '{"username":"one143_c"}'),
  ('dddddddd-0000-0000-0000-000000000143', 'd@one143.test', '{"username":"one143_d"}'),
  ('eeeeeeee-0000-0000-0000-000000000143', 'e@one143.test', '{"username":"one143_e"}'),
  ('ffffffff-0000-0000-0000-000000000143', 'f@one143.test', '{"username":"one143_f"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000143', 'business', 'one143_b_biz', 'B Heating'),
  ('cccccccc-0000-0000-0000-000000000143', 'business', 'one143_c_biz', 'C Plumbing'),
  ('dddddddd-0000-0000-0000-000000000143', 'business', 'one143_d_biz', 'D Electric'),
  ('ffffffff-0000-0000-0000-000000000143', 'business', 'one143_f_biz', 'F Roofing');
INSERT INTO public.business_profiles (profile_id)
SELECT id FROM public.profiles WHERE username IN ('one143_b_biz', 'one143_c_biz', 'one143_d_biz', 'one143_f_biz');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one143_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one143_b_biz') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one143_c') AS ci,
  (SELECT id FROM public.profiles WHERE username = 'one143_c_biz') AS cb,
  (SELECT id FROM public.profiles WHERE username = 'one143_d_biz') AS db,
  (SELECT id FROM public.profiles WHERE username = 'one143_e') AS ei,
  (SELECT id FROM public.profiles WHERE username = 'one143_f') AS fi,
  (SELECT id FROM public.profiles WHERE username = 'one143_f_biz') AS fb,
  '22222222-0000-0000-0000-0000000001a1'::uuid AS p,
  '22222222-0000-0000-0000-0000000001a2'::uuid AS other,
  '22222222-0000-0000-0000-0000000001e1'::uuid AS e_owner,
  '22222222-0000-0000-0000-0000000001e2'::uuid AS e_contrib,
  '22222222-0000-0000-0000-0000000001e3'::uuid AS e_proposed,
  '22222222-0000-0000-0000-0000000001e4'::uuid AS e_declined;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.projects (id, owner_profile_id, name, is_public) VALUES
  ((SELECT p FROM ids), (SELECT ai FROM ids), 'Furnace', true),
  ((SELECT other FROM ids), (SELECT ai FROM ids), 'Shed', true);
INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT p FROM ids), (SELECT bb FROM ids));
INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code, dest_project_id, active) VALUES
  ((SELECT ai FROM ids), 'physical', 'qr', 'LGPTAG23', (SELECT p FROM ids), true),
  ((SELECT ai FROM ids), 'physical', 'qr', 'LGPFFF23', (SELECT p FROM ids), false);
INSERT INTO public.scans (tag_id, scanner_profile_id) VALUES
  ((SELECT id FROM public.tags WHERE short_code = 'LGPTAG23'), (SELECT ci FROM ids)),
  ((SELECT id FROM public.tags WHERE short_code = 'LGPTAG23'), (SELECT ei FROM ids)),
  ((SELECT id FROM public.tags WHERE short_code = 'LGPFFF23'), (SELECT fi FROM ids));

-- ─── As account A, the owner ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT ai FROM ids)), 'published',
  'the owner''s entries are published');
SELECT lives_ok(
  $$INSERT INTO public.project_log_entries (id, project_id, occurred_on, title)
    VALUES ((SELECT e_owner FROM ids), (SELECT p FROM ids), '2026-03-01', 'Installed')$$,
  'the owner logs an entry without naming an author');
SELECT is(
  (SELECT row(author_profile_id, status)::text FROM public.project_log_entries WHERE id = (SELECT e_owner FROM ids)),
  row((SELECT ai FROM ids), 'published')::text,
  'which is the owner''s, and published');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, status)
    VALUES ((SELECT p FROM ids), '2026-03-02', 'Draft', 'proposed')$$,
  '42501', NULL, 'the owner never proposes');

-- ─── As account B, a Linked Contributor ───────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT bb FROM ids)), 'published',
  'a Contributor''s entries are published');
SELECT lives_ok(
  $$INSERT INTO public.project_log_entries (id, project_id, occurred_on, title, author_profile_id)
    VALUES ((SELECT e_contrib FROM ids), (SELECT p FROM ids), '2026-03-10', 'Annual service', (SELECT bb FROM ids))$$,
  'a Contributor writes to the log');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, author_profile_id, status)
    VALUES ((SELECT p FROM ids), '2026-03-10', 'Maybe', (SELECT bb FROM ids), 'proposed')$$,
  '42501', NULL, 'and never proposes either');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title)
    VALUES ((SELECT p FROM ids), '2026-03-10', 'As the owner')$$,
  '42501', NULL, 'nor writes as the owner');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, author_profile_id)
    VALUES ((SELECT other FROM ids), '2026-03-10', 'Elsewhere', (SELECT bb FROM ids))$$,
  '42501', NULL, 'nor on a project it isn''t Linked to');
SELECT lives_ok(
  $$UPDATE public.project_log_entries SET title = 'Annual service, filter changed' WHERE id = (SELECT e_contrib FROM ids)$$,
  'an author edits their own entry');
UPDATE public.project_log_entries SET title = 'Rewritten' WHERE id = (SELECT e_owner FROM ids);

-- ─── As account C, whose individual profile scanned the tag ───────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT cb FROM ids)), 'proposed',
  'a business whose account scanned the tag may propose');
SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT ci FROM ids)), NULL,
  'but not as the individual who scanned it');
SELECT lives_ok(
  $$INSERT INTO public.project_log_entries (id, project_id, occurred_on, title, author_profile_id, status)
    VALUES ((SELECT e_proposed FROM ids), (SELECT p FROM ids), '2026-04-01', 'Replaced the igniter', (SELECT cb FROM ids), 'proposed')$$,
  'C proposes an entry');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, author_profile_id)
    VALUES ((SELECT p FROM ids), '2026-04-01', 'Straight in', (SELECT cb FROM ids))$$,
  '42501', NULL, 'and cannot publish one');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE id = (SELECT e_proposed FROM ids)), 1,
  'C reads its own proposal');
SELECT throws_ok(
  $$UPDATE public.project_log_entries SET status = 'published' WHERE id = (SELECT e_proposed FROM ids)$$,
  '42501', NULL, 'C cannot publish its proposal');
SELECT lives_ok(
  $$UPDATE public.project_log_entries SET notes = 'Part on order' WHERE id = (SELECT e_proposed FROM ids)$$,
  'but edits it');
SELECT lives_ok(
  $$INSERT INTO public.project_log_media (entry_id, url) VALUES ((SELECT e_proposed FROM ids), 'https://example.test/igniter.jpg')$$,
  'and adds a photo to it');
SELECT throws_ok(
  $$SELECT public.approve_log_entry((SELECT e_proposed FROM ids))$$,
  '42501', NULL, 'C cannot approve its own proposal');
SELECT lives_ok(
  $$INSERT INTO public.project_log_entries (id, project_id, occurred_on, title, author_profile_id, status)
    VALUES ((SELECT e_declined FROM ids), (SELECT p FROM ids), '2026-04-02', 'Upsell', (SELECT cb FROM ids), 'proposed')$$,
  'C proposes a second entry');

-- ─── As account D, a business that never scanned ──────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT db FROM ids)), NULL,
  'a business that never scanned the tag may not propose');
SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, author_profile_id, status)
    VALUES ((SELECT p FROM ids), '2026-04-01', 'Cold call', (SELECT db FROM ids), 'proposed')$$,
  '42501', NULL, 'and its proposal is refused');
SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT cb FROM ids)), NULL,
  'nor is it told what another business may do');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT p FROM ids) AND status = 'proposed'), 0,
  'D reads no proposal');
SELECT is((SELECT count(*)::int FROM public.project_log_media WHERE entry_id = (SELECT e_proposed FROM ids)), 0,
  'nor its photos');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT p FROM ids)), 2,
  'but reads the published log');
SELECT throws_ok(
  $$SELECT public.approve_log_entry((SELECT e_proposed FROM ids))$$,
  '42501', NULL, 'and cannot approve anything');
UPDATE public.project_log_entries SET title = 'Hijacked' WHERE id = (SELECT e_contrib FROM ids);
DELETE FROM public.project_log_entries WHERE id = (SELECT e_proposed FROM ids);

-- ─── As account E, an individual who scanned ──────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.project_log_entries (project_id, occurred_on, title, author_profile_id, status)
    VALUES ((SELECT p FROM ids), '2026-04-01', 'I was here', (SELECT ei FROM ids), 'proposed')$$,
  '42501', NULL, 'an individual who scanned the tag cannot propose');

-- ─── As account F, whose scan was of a paused tag ─────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(public.log_entry_status_for((SELECT p FROM ids), (SELECT fb FROM ids)), NULL,
  'a scan of a paused tag lets no one propose');

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE project_id = (SELECT p FROM ids)), 2,
  'anon reads the published log, and no proposal');
SELECT throws_ok($$SELECT public.log_entry_status_for((SELECT p FROM ids), (SELECT cb FROM ids))$$,
  '42501', NULL, 'anon cannot call log_entry_status_for()');

-- ─── Back as the owner ────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT is(
  (SELECT row(title)::text FROM public.project_log_entries WHERE id = (SELECT e_contrib FROM ids)),
  row('Annual service, filter changed')::text,
  'D''s update of B''s entry reached nothing');
SELECT is((SELECT title FROM public.project_log_entries WHERE id = (SELECT e_owner FROM ids)), 'Installed',
  'B changed nothing of the owner''s');
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE status = 'proposed' AND project_id = (SELECT p FROM ids)), 2,
  'the owner reads both proposals, and D''s delete reached neither');
SELECT is(
  (SELECT array_agg(type || ':' || (SELECT username FROM public.profiles WHERE id = sender_id) ORDER BY type, created_at)
   FROM public.notifications WHERE receiver_id = (SELECT ai FROM ids) AND project_id = (SELECT p FROM ids)),
  ARRAY['log_entry_added:one143_b_biz', 'log_entry_proposed:one143_c_biz', 'log_entry_proposed:one143_c_biz'],
  'the owner heard of the Contributor''s entry and both proposals, and not of their own');

SELECT ok(public.approve_log_entry((SELECT e_proposed FROM ids)), 'the owner approves C''s proposal');
SELECT is((SELECT status FROM public.project_log_entries WHERE id = (SELECT e_proposed FROM ids)), 'published',
  'and it is published');
SELECT is(
  (SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT p FROM ids) AND contributor_profile_id = (SELECT cb FROM ids)),
  1, 'and C''s business is Linked as a Contributor');
SELECT ok(NOT public.approve_log_entry((SELECT e_proposed FROM ids)), 'approving it again does nothing');

SELECT lives_ok($$DELETE FROM public.project_log_entries WHERE id = (SELECT e_declined FROM ids)$$,
  'the owner declines the other proposal');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE log_entry_id = (SELECT e_declined FROM ids)), 0,
  'and its notification goes with it');

SELECT throws_ok(
  $$UPDATE public.project_log_entries SET status = 'proposed' WHERE id = (SELECT e_owner FROM ids)$$,
  '42501', NULL, 'nothing moves a published entry back to proposed');
SELECT throws_ok(
  $$UPDATE public.project_log_entries SET author_profile_id = (SELECT bb FROM ids) WHERE id = (SELECT e_owner FROM ids)$$,
  '42501', NULL, 'an entry keeps its author');
SELECT throws_ok(
  $$UPDATE public.project_log_entries SET project_id = (SELECT other FROM ids) WHERE id = (SELECT e_contrib FROM ids)$$,
  '42501', NULL, 'and stays on its project');
SELECT lives_ok(
  $$UPDATE public.project_log_entries SET notes = 'Checked' WHERE id = (SELECT e_contrib FROM ids)$$,
  'the owner edits a Contributor''s entry');

-- ─── B, now that C is Linked too ──────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000143","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.project_log_media (entry_id, url) VALUES ((SELECT e_proposed FROM ids), 'https://example.test/x.jpg')$$,
  '42501', NULL, 'a Contributor cannot add photos to someone else''s entry');
SELECT lives_ok($$DELETE FROM public.project_log_entries WHERE id = (SELECT e_contrib FROM ids)$$,
  'an author deletes their own entry');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.project_log_entries WHERE id = (SELECT e_contrib FROM ids)), 0, 'and it is gone');

SELECT * FROM finish();
ROLLBACK;
