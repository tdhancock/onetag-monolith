-- Tags and Scans (ONE-27, with ONE-82's read model and ONE-83's
-- destinations). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual profile AA (signup trigger). Owns the tags.
-- Account B: individual profile BA. Scans A's tag.
-- Account C: individual profile CA. Unrelated to both.
--
-- Tag T1 (active) and T2 (paused) belong to A and point at AA. Tag T3 belongs
-- to B, with one scan already, so "its own tags only" has something to exclude.

BEGIN;
SELECT plan(42);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000027', 'a@one27.test', '{"username":"one27_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000027', 'b@one27.test', '{"username":"one27_b"}'),
  ('cccccccc-0000-0000-0000-000000000027', 'c@one27.test', '{"username":"one27_c"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one27_a') AS aa,
  (SELECT id FROM public.profiles WHERE username = 'one27_b') AS ba,
  (SELECT id FROM public.profiles WHERE username = 'one27_c') AS ca,
  'dddddddd-0000-0000-0000-000000000001'::uuid AS t1,
  'dddddddd-0000-0000-0000-000000000002'::uuid AS t2,
  'dddddddd-0000-0000-0000-000000000003'::uuid AS t3;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id)
VALUES ((SELECT t3 FROM ids), (SELECT ba FROM ids), 'physical', 'qr', (SELECT ba FROM ids));
INSERT INTO public.scans (tag_id) VALUES ((SELECT t3 FROM ids));

-- ─── 1. Creating tags, as account A ───────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000027","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (id, owner_profile_id, tag_type, format, name, dest_profile_id)
    VALUES ((SELECT t1 FROM ids), (SELECT aa FROM ids), 'physical', 'qr', 'Front door', (SELECT aa FROM ids))$$,
  'the owner can create a tag pointing at its own profile');

SELECT is(
  (SELECT char_length(short_code) FROM public.tags WHERE id = (SELECT t1 FROM ids)),
  8, 'a tag inserted without a short_code gets an 8-character one');

SELECT lives_ok(
  $$INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_profile_id, active)
    VALUES ((SELECT t2 FROM ids), (SELECT aa FROM ids), 'digital', (SELECT aa FROM ids), false)$$,
  'the owner can create a paused digital tag');

SELECT isnt(
  (SELECT short_code FROM public.tags WHERE id = (SELECT t1 FROM ids)),
  (SELECT short_code FROM public.tags WHERE id = (SELECT t2 FROM ids)),
  'each tag gets its own short code');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id)
    VALUES ((SELECT aa FROM ids), 'physical', (SELECT ba FROM ids))$$,
  '42501', NULL, 'a user cannot create a tag pointing at a profile they do not own');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id)
    VALUES ((SELECT ba FROM ids), 'physical', (SELECT ba FROM ids))$$,
  '42501', NULL, 'a user cannot create a tag owned by someone else''s profile');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type) VALUES ((SELECT aa FROM ids), 'physical')$$,
  '23514', NULL, 'the destination check rejects zero destinations');

SELECT hasnt_column(
  'public', 'tags', 'dest_post_id',
  'a post is not a Destination (ONE-83)');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id, short_code)
    VALUES ((SELECT aa FROM ids), 'physical', (SELECT aa FROM ids), 'O0l1I234')$$,
  '23514', NULL, 'a short code outside the unambiguous alphabet is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, dest_profile_id)
    VALUES ((SELECT aa FROM ids), 'physical', 'nfc', (SELECT aa FROM ids))$$,
  '23514', NULL, 'qr is the only format');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_profile_id = (SELECT ba FROM ids) WHERE id = (SELECT t1 FROM ids)$$,
  '42501', NULL, 'a tag cannot be re-pointed at a profile its owner does not own');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE id IN ((SELECT t1 FROM ids), (SELECT t2 FROM ids))),
  2, 'the owner reads its own tags, paused ones included');

-- ─── 2. Anonymous: record, but never read ─────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.tags),
  0, 'a stranger reads no tags from the table — resolution goes through resolve_tag');

SELECT lives_ok(
  $$INSERT INTO public.scans (tag_id) VALUES ((SELECT t1 FROM ids))$$,
  'an anonymous client can insert a scan with a null scanner_profile_id');

SELECT throws_ok(
  $$INSERT INTO public.scans (tag_id, scanner_profile_id) VALUES ((SELECT t1 FROM ids), (SELECT ba FROM ids))$$,
  '42501', NULL, 'an anonymous client cannot attribute a scan to a profile');

SELECT throws_ok(
  $$INSERT INTO public.scans (tag_id) VALUES ((SELECT t2 FROM ids))$$,
  '42501', NULL, 'nobody can record a scan of a paused tag');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id)
    VALUES ((SELECT aa FROM ids), 'physical', (SELECT aa FROM ids))$$,
  '42501', NULL, 'an anonymous client cannot insert a tag');

SELECT is(
  (SELECT count(*)::int FROM public.scans),
  0, 'an anonymous client cannot read scans');

-- ─── 3. Account B scans A's tag ───────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000027","role":"authenticated"}', true);

-- Sent with a month-old time, which the trigger replaces.
SELECT lives_ok(
  $$INSERT INTO public.scans (tag_id, scanner_profile_id, scanned_at)
    VALUES ((SELECT t1 FROM ids), (SELECT ba FROM ids), now() - interval '30 days')$$,
  'a signed-in scanner records a scan against its own profile');

SELECT throws_ok(
  $$INSERT INTO public.scans (tag_id, scanner_profile_id) VALUES ((SELECT t1 FROM ids), (SELECT ca FROM ids))$$,
  '42501', NULL, 'nobody can forge a scan attributed to another profile');

SELECT is(
  (SELECT count(*)::int FROM public.scans WHERE tag_id = (SELECT t1 FROM ids)),
  1, 'the scanner sees its own scan, and not the anonymous one');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE id = (SELECT t1 FROM ids)),
  0, 'a scanner cannot read the tag it scanned');

WITH u AS (UPDATE public.scans SET scanned_at = now() - interval '1 day' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'scans cannot be updated — the log is append-only');

WITH d AS (DELETE FROM public.scans RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'scans cannot be deleted — the log is append-only');

-- ─── 4. Account C, unrelated ──────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000027","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.scans WHERE tag_id = (SELECT t1 FROM ids)),
  0, 'an unrelated user cannot see scans of the tag');

SELECT is(
  (SELECT count(*)::int FROM public.tag_scan_counts((SELECT aa FROM ids))),
  0, 'an unrelated user gets no counts for a profile it does not own');

WITH u AS (UPDATE public.tags SET name = 'hijacked' WHERE id = (SELECT t1 FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'an unrelated user cannot update the tag');

WITH d AS (DELETE FROM public.tags WHERE id = (SELECT t1 FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'an unrelated user cannot delete the tag');

-- ─── 5. Back to A, the tag's owner ────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000027","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.scans),
  0, 'a tag owner reads no scan rows — never who scanned (ONE-82)');

SELECT is(
  (SELECT scan_count FROM public.tag_scan_counts((SELECT aa FROM ids)) WHERE tag_id = (SELECT t1 FROM ids)),
  2::bigint, 'a tag owner gets how many scans its tag has had, anonymous ones included');

SELECT ok(
  (SELECT last_scanned_at FROM public.tag_scan_counts((SELECT aa FROM ids)) WHERE tag_id = (SELECT t1 FROM ids)) IS NOT NULL,
  'and when it was last scanned');

SELECT is(
  (SELECT array_agg(tag_id ORDER BY tag_id) FROM public.tag_scan_counts((SELECT aa FROM ids))),
  ARRAY[(SELECT t1 FROM ids), (SELECT t2 FROM ids)],
  'the counts cover that profile''s own tags and no others');

WITH u AS (UPDATE public.tags SET active = false, name = 'Back door' WHERE id = (SELECT t1 FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner can pause and rename its tag');

-- ─── 6. As the database owner ─────────────────────────────────────────

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.scans WHERE scanner_profile_id IS NULL AND tag_id = (SELECT t1 FROM ids)),
  1, 'the anonymous scan was recorded with a null scanner_profile_id');

SELECT is(
  (SELECT scanned_at FROM public.scans WHERE scanner_profile_id = (SELECT ba FROM ids)),
  now(), 'a scan is stamped when it is recorded — never backdated');

SELECT ok(
  NOT has_function_privilege('anon', 'public.tag_scan_counts(uuid)', 'EXECUTE'),
  'anon cannot read scan counts');

SELECT ok(
  has_function_privilege('anon', 'public.tag_accepts_scans(uuid)', 'EXECUTE'),
  'anon can check whether a tag takes scans — its insert policy needs to');

CREATE TEMP TABLE codes ON COMMIT DROP AS
SELECT public.gen_short_code() AS code FROM generate_series(1, 10000);

SELECT is(
  (SELECT count(*)::int FROM codes WHERE char_length(code) <> 8),
  0, '10,000 generated codes are all 8 characters');

SELECT is(
  (SELECT count(*)::int FROM codes WHERE code ~ '[0O1Il]'),
  0, '10,000 generated codes contain none of 0, O, 1, I or l');

SELECT is(
  (SELECT count(*)::int FROM codes
   WHERE code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$'),
  0, '10,000 generated codes are drawn only from the unambiguous alphabet');

SELECT is(
  (SELECT count(DISTINCT code)::int FROM codes),
  10000, '10,000 generated codes produce no duplicates');

SELECT ok(
  NOT has_function_privilege('anon', 'public.gen_short_code()', 'EXECUTE'),
  'anon cannot generate short codes');

SELECT * FROM finish();
ROLLBACK;
