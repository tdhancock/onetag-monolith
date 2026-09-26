//
// target: __tests__/supabase/protect-profile-type.test.ts
//
// The protect_profile_type migration (ONE-79).
//
// Two layers, as business-profiles.test.ts set:
//
//   1. This suite pins the *shape* of the migration — a trigger of its own,
//      firing on profile_type, refusing any real change unless the caller is
//      the database owner — so nobody loosens it later without the diff being
//      obvious.
//   2. supabase/tests/protect_profile_type.test.sql pins the *behaviour*
//      against a real database (`npm run db:test`, local stack). This suite
//      checks that file still carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_protect_profile_type.sql'));
if (!file) throw new Error('No *_protect_profile_type.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

describe('the trigger', () => {
  it('fires before any update touching profile_type', () => {
    expect(sql).toContain('BEFORE UPDATE OF profile_type ON public.profiles');
    expect(sql).toContain('EXECUTE FUNCTION public.protect_profile_type()');
  });

  it('refuses a real change, but not a re-sent value', () => {
    expect(sql).toContain('NEW.profile_type IS DISTINCT FROM OLD.profile_type');
    expect(sql).toContain("ERRCODE = '42501'");
  });

  it('exempts only the database owner, as protect_profile_verified does', () => {
    expect(sql).toContain(
      "privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role') " +
        "OR coalesce(auth.role(), 'service_role') = 'service_role';",
    );
    // Converting a profile is not an admin feature.
    expect(sql).not.toContain('is_admin');
  });

  it('is its own function, plpgsql with a pinned search_path', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.protect_profile_type()');
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).not.toContain('protect_profile_verified()');
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'protect_profile_type.test.sql'), 'utf8');

  it.each([
    'the owner cannot flip business to individual',
    'the owner cannot flip individual to business',
    'the owner can still edit the bio of a business profile',
    'the owner can still edit the bio of an individual profile',
    'an update that re-sends the same profile_type succeeds',
    'after RESET ROLE, the database owner can change profile_type',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });

  it('expects 42501 for both flips', () => {
    expect(pgTap.match(/'42501', NULL, 'the owner cannot flip/g)).toHaveLength(2);
  });
});
