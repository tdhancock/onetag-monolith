-- Text OneSnaps: no media, their words in `caption` and their gradient in
-- `background` (ONE-78). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.

BEGIN;
SELECT plan(9);

-- ─── Schema ───────────────────────────────────────────────────────────

SELECT col_is_null('public', 'stories', 'media_url', 'a OneSnap no longer needs media');
SELECT has_column('public', 'stories', 'background', 'stories carry a background');
SELECT col_is_null('public', 'stories', 'background', 'the background is optional');

-- ─── Fixture: one account, acting as its profile ──────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('78787878-0000-0000-0000-00000000000a', 'snap@one78.test', '{"username":"one78_snap"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE user_id = '78787878-0000-0000-0000-00000000000a') AS me;
GRANT SELECT ON ids TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"78787878-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- ─── Posting ──────────────────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.stories (user_id, media_url, caption, background)
    VALUES ((SELECT me FROM ids), NULL, 'hello from a text OneSnap', 'plum')$$,
  'a text OneSnap posts with no media, its words and its background');

SELECT is(
  (SELECT background FROM public.stories WHERE caption = 'hello from a text OneSnap'),
  'plum', 'the chosen background is stored and reads back');

SELECT lives_ok(
  $$INSERT INTO public.stories (user_id, media_url, caption)
    VALUES ((SELECT me FROM ids), 'https://example.test/snap.jpg', NULL)$$,
  'an image OneSnap still posts with no caption and no background');

SELECT throws_ok(
  $$INSERT INTO public.stories (user_id, media_url, caption)
    VALUES ((SELECT me FROM ids), NULL, '   ')$$,
  '23514', NULL, 'a OneSnap with neither media nor words is rejected');

SELECT throws_ok(
  $$INSERT INTO public.stories (user_id, media_url, caption, background)
    VALUES ((SELECT me FROM ids), NULL, 'hi', 'Not a key!')$$,
  '23514', NULL, 'a background that is not key-shaped is rejected');

SELECT throws_ok(
  $$INSERT INTO public.stories (user_id, media_url, caption, background)
    VALUES ('78787878-0000-0000-0000-0000000000ff', NULL, 'hi', 'plum')$$,
  '42501', NULL, 'the insert policy still holds: no posting as a profile you do not own');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
