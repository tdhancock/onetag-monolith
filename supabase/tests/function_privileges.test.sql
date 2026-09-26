-- Who may call which function (ONE-85). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Supabase grants EXECUTE on every new public function to anon directly, so
-- a function only signed-in callers should run revokes FROM PUBLIC, anon —
-- not PUBLIC alone. This pins both sides: the signed-in-only functions refuse
-- anon and still serve authenticated, and the ones anonymous callers need
-- stay open to them.

BEGIN;
SELECT plan(14);

-- ─── Signed-in only: anon refused ─────────────────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'),
  'anon cannot execute is_admin()');
SELECT ok(NOT has_function_privilege('anon', 'public.is_blocked_by(uuid)', 'EXECUTE'),
  'anon cannot execute is_blocked_by()');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_chat_history(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute delete_chat_history()');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_conversation(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute delete_conversation()');

-- ─── …and still open to signed-in callers ─────────────────────────────

SELECT ok(has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'),
  'authenticated can execute is_admin()');
SELECT ok(has_function_privilege('authenticated', 'public.is_blocked_by(uuid)', 'EXECUTE'),
  'authenticated can execute is_blocked_by()');
SELECT ok(has_function_privilege('authenticated', 'public.delete_chat_history(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute delete_chat_history()');
SELECT ok(has_function_privilege('authenticated', 'public.delete_conversation(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute delete_conversation()');

-- ─── Anonymous on purpose ─────────────────────────────────────────────

SELECT ok(has_function_privilege('anon', 'public.owns_profile(uuid)', 'EXECUTE'),
  'anon can execute owns_profile(): the scan insert policy evaluates it for anonymous scans');
SELECT ok(has_function_privilege('anon', 'public.get_email_by_username(text)', 'EXECUTE'),
  'anon can execute get_email_by_username(): sign-in by username');
SELECT ok(has_function_privilege('anon', 'public.resolve_tag(text)', 'EXECUTE'),
  'anon can execute resolve_tag(): a stranger resolving a scanned tag');
SELECT ok(has_function_privilege('anon', 'public.tag_accepts_scans(uuid)', 'EXECUTE'),
  'anon can execute tag_accepts_scans(): the scan insert policy evaluates it for anonymous scans');

-- ─── Revoked by name elsewhere, and still so ──────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.create_profile(text, text, text, text)', 'EXECUTE'),
  'anon cannot execute create_profile() (ONE-80)');
SELECT ok(NOT has_function_privilege('anon', 'public.tag_scan_counts(uuid)', 'EXECUTE'),
  'anon cannot execute tag_scan_counts() (ONE-82)');

SELECT * FROM finish();
ROLLBACK;
