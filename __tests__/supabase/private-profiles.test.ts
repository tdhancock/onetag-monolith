//
// target: __tests__/supabase/private-profiles.test.ts
//
// Private accounts (ONE-58). `profiles.is_private` and the RLS that enforces
// it already existed; what was missing was any way to turn it on. This suite
// pins the three pieces the Settings switch depends on: the client writes the
// column, the owner may write it, and the posts policy hides a private
// profile's posts from non-followers while existing followers keep access.
//
// The SQL assertions are static, as in blocks.test.ts — Jest here has no
// Postgres. The behaviour was verified against a local stack while the ticket
// was worked, in a rolled-back transaction: as the owner, `UPDATE profiles
// SET is_private = true` succeeded and read back true; as a stranger, the
// same update on the owner's row changed 0 rows and a count of the owner's
// posts returned 0; as an existing follower it returned 1; after the owner
// switched back to public the stranger's count returned 1.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

jest.mock('../../services/supabase.native', () => ({ supabase: {} }));

import { mapProfileUpdatesToRow } from '../../features/profiles/api';
import { isProfileLocked, PRIVATE_ACCOUNT_DESCRIPTION } from '../../lib/screens/profile';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

const migration = (suffix: string): string => {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`No *${suffix} migration found`);
  return readFileSync(join(MIGRATIONS, file), 'utf8');
};

/** Collapse whitespace so assertions do not depend on formatting. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

describe('the write path', () => {
  it('maps isPrivate onto profiles.is_private, in both directions', () => {
    expect(mapProfileUpdatesToRow({ isPrivate: true })).toEqual({ is_private: true });
    expect(mapProfileUpdatesToRow({ isPrivate: false })).toEqual({ is_private: false });
  });

  it('leaves the column alone when the update does not mention it', () => {
    expect(mapProfileUpdatesToRow({ bio: 'hi' })).not.toHaveProperty('is_private');
  });

  it('lets a user update their own profile row, and only their own', () => {
    expect(flat(migration('_core_schema.sql'))).toContain(
      'CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()))',
    );
  });
});

describe('the posts policy', () => {
  const sql = flat(migration('_admin_and_privacy.sql'));
  const policy = sql.slice(sql.indexOf('CREATE POLICY "Posts visible unless author is private"'));

  it('hides a private profile\'s posts from anyone who is not a follower', () => {
    expect(policy).toContain(
      'OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = posts.user_id AND p.is_private)',
    );
  });

  it('lets an existing follower keep seeing them — going private does not evict anyone', () => {
    expect(policy).toContain(
      'OR EXISTS ( SELECT 1 FROM public.follows f WHERE f.follower_id = (SELECT auth.uid()) AND f.followed_id = posts.user_id )',
    );
  });

  it('always lets the owner see their own posts', () => {
    expect(policy).toContain('USING ( user_id = (SELECT auth.uid())');
  });
});

describe('the locked profile state', () => {
  const base = { isPrivate: true, isOwnProfile: false, isFollowing: false };

  it('locks a private profile for a non-follower', () => {
    expect(isProfileLocked(base)).toBe(true);
  });

  it('does not lock it for an existing follower, the owner, or an admin', () => {
    expect(isProfileLocked({ ...base, isFollowing: true })).toBe(false);
    expect(isProfileLocked({ ...base, isOwnProfile: true })).toBe(false);
    expect(isProfileLocked({ ...base, isAdmin: true })).toBe(false);
  });

  it('never locks a public profile', () => {
    expect(isProfileLocked({ ...base, isPrivate: false })).toBe(false);
    expect(isProfileLocked({ ...base, isPrivate: undefined })).toBe(false);
  });

  it('tells the user that existing followers keep access', () => {
    expect(PRIVATE_ACCOUNT_DESCRIPTION).toMatch(/already follow you keep access/);
  });
});
