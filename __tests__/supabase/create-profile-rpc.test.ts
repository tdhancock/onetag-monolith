//
// target: __tests__/supabase/create-profile-rpc.test.ts
//
// The create_profile function (ONE-80).
//
// Two layers, as business-profiles.test.ts set:
//
//   1. This suite pins the *shape* of the migration — the function runs as
//      its caller, takes the account only from auth.uid(), lets unique
//      violations through, and is executable by signed-in callers alone — so
//      nobody loosens it later without the diff being obvious.
//   2. supabase/tests/create_profile.test.sql pins the *behaviour* against a
//      real database (`npm run db:test`, local stack). This suite checks that
//      file still carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_create_profile_rpc.sql'));
if (!file) throw new Error('No *_create_profile_rpc.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

describe('the function', () => {
  it('takes the kind, handle, name and bio — and no account', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.create_profile( p_profile_type TEXT, p_username TEXT, p_full_name TEXT, p_bio TEXT DEFAULT NULL ) RETURNS public.profiles',
    );
    expect(sql).not.toMatch(/p_user_id|p_account/);
  });

  it('runs as its caller, so RLS and the type guard apply as they did to the direct inserts', () => {
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).not.toContain('SECURITY DEFINER');
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain("SET search_path = ''");
  });

  it('owns the profile to auth.uid(), and refuses a caller without one', () => {
    expect(sql).toContain('account UUID := auth.uid();');
    expect(sql).toContain('IF account IS NULL THEN');
    expect(sql).toContain("ERRCODE = '42501'");
    expect(sql).toContain('VALUES (account, p_profile_type, p_username, p_full_name, p_bio)');
  });

  it("writes a business profile's business row in the same call", () => {
    expect(sql).toContain("IF p_profile_type = 'business' THEN INSERT INTO public.business_profiles (profile_id) VALUES (created.id);");
  });

  it('lets unique violations reach the client with their constraint names', () => {
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(sql).not.toContain('23505');
  });
});

describe('the grants', () => {
  const signature = 'public.create_profile(TEXT, TEXT, TEXT, TEXT)';

  it('revokes from PUBLIC and, by name, from anon — which Supabase grants directly', () => {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`);
  });

  it('grants execute to signed-in callers only', () => {
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.create_profile[^;]*anon/);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'create_profile.test.sql'), 'utf8');

  it.each([
    'one call creates a business profile and its business row',
    'an individual profile gets no business row',
    'a failed second insert leaves nothing behind',
    'a duplicate handle raises 23505 naming profiles_username_lower_key',
    'a second business profile raises 23505 naming profiles_one_per_type',
    'the function refuses a caller with no auth.uid()',
    'anon cannot execute the function',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });

  it('makes the second insert fail by revoking it inside the rolled-back transaction', () => {
    expect(pgTap).toContain('REVOKE INSERT ON public.business_profiles FROM authenticated;');
    expect(pgTap.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
