-- Scan History, private by default (ONE-35). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. This is the API-level
-- privacy suite: each check reads as the role and account PostgREST would.
--
-- Account O: individual OI and business OB — owns the tags. T1 points at OI,
--            T2 at product PD (listed by OB), T3 at OI's private project PJ.
-- Account A: individual AI — the scanner. Scanned T1 ten times, T2 and T3 once.
-- Account B: individual BI — a stranger to all of it.

BEGIN;
SELECT plan(23);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000000a035', 'a@one35.test', '{"username":"one35_a"}'),
  ('00000000-0000-0000-0000-00000000b035', 'b@one35.test', '{"username":"one35_b"}'),
  ('00000000-0000-0000-0000-00000000f035', 'o@one35.test', '{"username":"one35_o"}');

UPDATE public.profiles SET full_name = 'Olive Oakes' WHERE username = 'one35_o';
INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('00000000-0000-0000-0000-00000000f035', 'business', 'one35_o_biz', 'O Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one35_o_biz';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one35_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one35_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one35_o') AS oi,
  (SELECT id FROM public.profiles WHERE username = 'one35_o_biz') AS ob,
  'd0000000-0000-0000-0000-000000000035'::uuid AS pd,
  'e0000000-0000-0000-0000-000000000035'::uuid AS pj,
  'a1000000-0000-0000-0000-000000000035'::uuid AS t1,
  'a2000000-0000-0000-0000-000000000035'::uuid AS t2,
  'a3000000-0000-0000-0000-000000000035'::uuid AS t3;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.products (id, business_profile_id, name) VALUES ((SELECT pd FROM ids), (SELECT ob FROM ids), 'Oak door');
INSERT INTO public.projects (id, owner_profile_id, name, is_public) VALUES ((SELECT pj FROM ids), (SELECT oi FROM ids), 'Hidden cabin', false);

INSERT INTO public.tags (id, owner_profile_id, tag_type, format, name, note, dest_profile_id)
VALUES ((SELECT t1 FROM ids), (SELECT oi FROM ids), 'physical', 'qr', 'Gate sign', 'owner-only note', (SELECT oi FROM ids));
INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_product_id)
VALUES ((SELECT t2 FROM ids), (SELECT ob FROM ids), 'digital', (SELECT pd FROM ids));
INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_project_id)
VALUES ((SELECT t3 FROM ids), (SELECT oi FROM ids), 'digital', (SELECT pj FROM ids));

-- Ten scans of T1, an hour apart; T2 most recently; T3 in between.
INSERT INTO public.scans (tag_id, scanner_profile_id) SELECT (SELECT t1 FROM ids), (SELECT ai FROM ids) FROM generate_series(1, 10);
UPDATE public.scans s SET scanned_at = now() - (n.rank || ' hours')::interval
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rank FROM public.scans WHERE tag_id = (SELECT t1 FROM ids)) n
WHERE s.id = n.id;
INSERT INTO public.scans (tag_id, scanner_profile_id) VALUES ((SELECT t2 FROM ids), (SELECT ai FROM ids));
UPDATE public.scans SET scanned_at = now() - interval '30 minutes' WHERE tag_id = (SELECT t2 FROM ids);
INSERT INTO public.scans (tag_id, scanner_profile_id) VALUES ((SELECT t3 FROM ids), (SELECT ai FROM ids));
UPDATE public.scans SET scanned_at = now() - interval '5 hours 30 minutes' WHERE tag_id = (SELECT t3 FROM ids);

-- ─── 1. Private by default ────────────────────────────────────────────

SELECT is((SELECT scan_history_public FROM public.profiles WHERE id = (SELECT ai FROM ids)), false,
  'a newly created profile''s scan history is private');

SELECT col_default_is('public', 'profiles', 'scan_history_public', 'false',
  'the column defaults to private, so no migration opts anyone in');

-- As the stranger, B.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE scanner_profile_id = (SELECT ai FROM ids)), 0,
  'another account reads none of a private history''s scans through the API');
SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 0,
  'nor through scan_history');

-- As the tags' owner, O.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE tag_id IN ((SELECT t1 FROM ids), (SELECT t2 FROM ids))), 0,
  'the owner of the tags scanned reads no private scans of them (ONE-82)');

-- Anonymous.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE scanner_profile_id = (SELECT ai FROM ids)), 0,
  'an anonymous client reads no private scans');
SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 0,
  'nor a private scan_history');

-- ─── 2. The scanner's own history ─────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE scanner_profile_id = (SELECT ai FROM ids)), 12,
  'the scanner reads every scan of their own, whatever the setting');

SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 2,
  'their history collapses repeats to one row per destination, leaving out a private project they cannot see');

SELECT is(
  (SELECT row(scan_count, last_scanned_at = now() - interval '1 hour')::text FROM public.scan_history((SELECT ai FROM ids)) WHERE dest_kind = 'profile'),
  row(10::bigint, true)::text,
  'the same tag scanned ten times is one entry, counting 10, with the latest time');

SELECT is(
  (SELECT dest_kind FROM public.scan_history((SELECT ai FROM ids)) LIMIT 1),
  'product', 'the most recently scanned destination comes first');

SELECT is(
  (SELECT row(dest_id, dest_name, dest_username)::text FROM public.scan_history((SELECT ai FROM ids)) WHERE dest_kind = 'profile'),
  row((SELECT oi FROM ids), 'Olive Oakes', 'one35_o')::text,
  'a profile destination carries its name and its handle to route by');

SELECT is(
  (SELECT row(dest_id, dest_name)::text FROM public.scan_history((SELECT ai FROM ids)) WHERE dest_kind = 'product'),
  row((SELECT pd FROM ids), 'Oak door')::text,
  'a product destination carries its name');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.scan_history((SELECT ai FROM ids)) h
    WHERE h.dest_name IN ('Gate sign', 'owner-only note')
  ),
  'the history never carries a tag''s own name or note');

-- ─── 3. Opening it ────────────────────────────────────────────────────

WITH u AS (UPDATE public.profiles SET scan_history_public = true WHERE id = (SELECT ai FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the scanner makes their history public');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE scanner_profile_id = (SELECT ai FROM ids)), 12,
  'once public, another account reads its scans through the API');
SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 2,
  'and its history — still without the private project');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 3,
  'the private project''s owner, who can see it, sees it in the public history');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 2,
  'an anonymous client reads a public history');

-- ─── 4. Closing it again ──────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a035","role":"authenticated"}', true);

WITH u AS (UPDATE public.profiles SET scan_history_public = false WHERE id = (SELECT ai FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the scanner makes their history private again');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b035","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.scans WHERE scanner_profile_id = (SELECT ai FROM ids)), 0,
  'closed, another account reads none of its scans — the ones it saw before included');
SELECT is((SELECT count(*)::int FROM public.scan_history((SELECT ai FROM ids))), 0,
  'nor its history');

RESET ROLE;

SELECT is(
  pg_get_function_result('public.scan_history(uuid)'::regprocedure),
  'TABLE(dest_kind text, dest_id uuid, dest_name text, dest_username text, scan_count bigint, last_scanned_at timestamp with time zone)',
  'scan_history returns where each tag led and how often — no tag id, name or note');

SELECT * FROM finish();
ROLLBACK;
