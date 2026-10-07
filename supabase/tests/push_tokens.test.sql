-- A push token for each device, not each account (ONE-112). Runs against a
-- real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- A signs in on a phone and a tablet. B later signs in on the tablet without
-- A having signed out there.

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000112a0', 'a@one112.test', '{"username":"one112_a"}'),
  ('00000000-0000-0000-0000-0000000112a1', 'b@one112.test', '{"username":"one112_b"}');

-- Every active token of an account, as send-push reads them.
CREATE FUNCTION pg_temp.devices(p_account UUID) RETURNS TEXT[]
LANGUAGE sql AS $$
  SELECT coalesce(array_agg(token ORDER BY token), '{}')
  FROM public.push_tokens WHERE user_id = p_account AND is_active;
$$;

-- ─── Signing in on two devices ────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000112a0","role":"authenticated"}', true);

SELECT lives_ok($$SELECT public.register_push_token('ExponentPushToken[phone]', 'ios')$$, 'A signs in on their phone');
SELECT lives_ok($$SELECT public.register_push_token('ExponentPushToken[tablet]', 'android')$$, 'and on their tablet');
SELECT lives_ok($$SELECT public.register_push_token('ExponentPushToken[phone]', 'ios')$$,
  'opening the app again on the phone registers it again, harmlessly');
RESET ROLE;

SELECT is(pg_temp.devices('00000000-0000-0000-0000-0000000112a0'),
  ARRAY['ExponentPushToken[phone]', 'ExponentPushToken[tablet]'],
  'a push to A reaches both devices, each once');
SELECT is((SELECT platform FROM public.push_tokens WHERE token = 'ExponentPushToken[tablet]'), 'android',
  'each row keeps its device''s platform');

-- ─── Another account on the same device ───────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000112a1","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.register_push_token('ExponentPushToken[tablet]', 'android')$$,
  'B signs in on the tablet, which A never signed out of');
RESET ROLE;

SELECT is(pg_temp.devices('00000000-0000-0000-0000-0000000112a1'), ARRAY['ExponentPushToken[tablet]'],
  'the tablet moves to B');
SELECT is(pg_temp.devices('00000000-0000-0000-0000-0000000112a0'), ARRAY['ExponentPushToken[phone]'],
  'so A''s pushes stop reaching it, and still reach A''s phone');

-- ─── Signing out ──────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000112a0","role":"authenticated"}', true);
DELETE FROM public.push_tokens WHERE token = 'ExponentPushToken[tablet]';
DELETE FROM public.push_tokens WHERE token = 'ExponentPushToken[phone]';
RESET ROLE;

SELECT is(pg_temp.devices('00000000-0000-0000-0000-0000000112a0'), '{}'::text[],
  'signing out on the phone removes it: A has no device left');
SELECT is(pg_temp.devices('00000000-0000-0000-0000-0000000112a1'), ARRAY['ExponentPushToken[tablet]'],
  'and A can''t remove B''s device');

-- ─── What's refused ───────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000112a0","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.push_tokens (user_id, token) VALUES ('00000000-0000-0000-0000-0000000112a0', 'ExponentPushToken[tablet]')$$,
  '23505', NULL, 'a direct insert can''t take a device from another account');
SELECT throws_ok($$SELECT public.register_push_token('  ', 'ios')$$, '22023', NULL, 'an empty token is refused');
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok($$SELECT public.register_push_token('ExponentPushToken[nobody]', 'ios')$$, '42501', NULL,
  'without a session, nothing registers');
RESET ROLE;

SELECT ok(NOT has_function_privilege('anon', 'public.register_push_token(text, text)', 'EXECUTE'),
  'anon cannot call register_push_token()');
SELECT ok(has_function_privilege('authenticated', 'public.register_push_token(text, text)', 'EXECUTE'),
  'signed-in users can');

-- ─── The table's shape ────────────────────────────────────────────────

SELECT col_is_unique('public', 'push_tokens', 'token', 'a token is unique: one row a device');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.push_tokens'::regclass AND i.indisunique
      AND i.indkey::int2[] = ARRAY[(SELECT attnum FROM pg_attribute
                                    WHERE attrelid = 'public.push_tokens'::regclass AND attname = 'user_id')]
  ),
  'and nothing limits an account to one');

SELECT * FROM finish();
ROLLBACK;
