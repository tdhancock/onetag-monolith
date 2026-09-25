//
// target: __tests__/supabase/rls-multi-profile.test.ts
//
// The multi-profile migration and its RLS rewrite (ONE-21).
//
// Two layers, because Jest here has no Postgres:
//
//   1. This suite pins the *shape* of the two migrations, so nobody quietly
//      loosens a policy later without the diff being obvious — the approach
//      blocks.test.ts set.
//   2. supabase/tests/rls_multi_profile.test.sql pins the *behaviour* against
//      a real database (`npm run db:test`, local stack): an account with two
//      profiles edits both; it cannot edit another account's profile; a post
//      by profile A is editable while acting as profile B; a post attributed
//      to a profile the account does not own is rejected; and blocks hold
//      through a profile whose id differs from its auth id. This suite checks
//      that file still carries each of those cases.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const migration = (suffix: string): string => {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`No *${suffix} migration found`);
  return readFileSync(join(MIGRATIONS, file), 'utf8');
};

/** Collapse whitespace so assertions do not depend on formatting. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

/** The SQL alone, without `--` comments, for assertions about statements. */
const statements = (sql: string): string => flat(sql.replace(/--.*$/gm, ''));

const schema = flat(migration('_multi_profile.sql'));
const rls = flat(migration('_multi_profile_rls.sql'));

/** Every CREATE POLICY in the rewrite, as { table, body }. */
const policies = (): { name: string; table: string; body: string }[] => {
  const found: { name: string; table: string; body: string }[] = [];
  const pattern = /CREATE POLICY "([^"]+)" ON public\.(\w+)(.*?);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rls)) !== null) {
    found.push({ name: match[1], table: match[2], body: match[3] });
  }
  return found;
};

describe('the schema change', () => {
  it('adds user_id, backfills it from id, then makes it required — in that order', () => {
    const add = schema.indexOf('ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE');
    const backfill = schema.indexOf('UPDATE public.profiles SET user_id = id;');
    const required = schema.indexOf('ALTER COLUMN user_id SET NOT NULL');
    expect(add).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(add);
    expect(required).toBeGreaterThan(backfill);
  });

  it('frees profiles.id from auth.users but keeps it the primary key, with a fresh default', () => {
    expect(schema).toContain('DROP CONSTRAINT profiles_id_fkey');
    expect(schema).toContain('ALTER COLUMN id SET DEFAULT gen_random_uuid()');
    expect(schema).not.toMatch(/DROP CONSTRAINT profiles_pkey/);
  });

  it('types every profile, individual by default', () => {
    expect(schema).toContain(
      "ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'individual' CHECK (profile_type IN ('individual', 'business'))",
    );
  });

  it('allows at most one profile of each type per account', () => {
    expect(schema).toContain('CREATE UNIQUE INDEX profiles_one_per_type ON public.profiles (user_id, profile_type)');
  });

  it('leaves handle uniqueness global — a business and an individual cannot share one', () => {
    expect(statements(migration('_multi_profile.sql'))).not.toContain('profiles_username_lower_key');
  });

  it('repoints push_tokens at the account', () => {
    expect(schema).toContain(
      'ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    );
  });

  it('gives a new account one individual profile with a fresh id', () => {
    expect(schema).toContain('INSERT INTO public.profiles (user_id, profile_type, username, full_name, avatar_url)');
    expect(schema).toContain("NEW.id, 'individual', candidate,");
    expect(schema).toContain('ON CONFLICT (user_id, profile_type) DO NOTHING');
  });

  it('keeps the username derivation and collision handling', () => {
    expect(schema).toContain("IF char_length(base_name) < 3 THEN base_name := 'user_' || substr(NEW.id::text, 1, 6);");
    expect(schema).toContain("candidate := left(base_name, 15) || '_' || substr(NEW.id::text, 1, 4);");
  });
});

describe('the ownership helper', () => {
  it('answers from the profile row and the caller, and nothing else', () => {
    expect(rls).toContain('CREATE OR REPLACE FUNCTION public.owns_profile(p_profile_id UUID)');
    expect(rls).toContain('WHERE id = p_profile_id AND user_id = (SELECT auth.uid())');
  });

  it('is a stable definer function with a pinned search_path', () => {
    const fn = rls.slice(rls.indexOf('FUNCTION public.owns_profile'), rls.indexOf('$$;', rls.indexOf('FUNCTION public.owns_profile')));
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('STABLE');
    expect(fn).toContain("SET search_path = ''");
  });

  it('is not left executable by PUBLIC', () => {
    expect(rls).toContain('REVOKE ALL ON FUNCTION public.owns_profile(UUID) FROM PUBLIC');
  });
});

describe('the RLS rewrite', () => {
  const PROFILE_OWNED = [
    'posts', 'likes', 'reposts', 'saved_posts', 'comments', 'comment_likes', 'follows',
    'stories', 'story_likes', 'story_views', 'notifications', 'messages', 'reports',
  ];

  it('rewrites a policy on every profile-owned table', () => {
    const tables = new Set(policies().map((p) => p.table));
    for (const table of PROFILE_OWNED) expect(tables).toContain(table);
  });

  it('never compares a profile-owned column straight to auth.uid()', () => {
    for (const { table, name, body } of policies()) {
      if (!PROFILE_OWNED.includes(table)) continue;
      expect(`${table}: ${name}: ${body}`).not.toMatch(/(user_id|follower_id|sender_id|receiver_id|reporter_id) = \(SELECT auth\.uid\(\)\)/);
      expect(body).toContain('public.owns_profile(');
    }
  });

  it('drops each policy before recreating it, so no permissive duplicate survives', () => {
    for (const { table, name } of policies()) {
      expect(rls).toContain(`DROP POLICY "${name}" ON public.${table};`);
    }
  });

  it('keys profiles on user_id directly, never through the helper', () => {
    const own = policies().filter((p) => p.table === 'profiles');
    expect(own.map((p) => p.name).sort()).toEqual(['Users can insert own profile', 'Users can update own profile']);
    for (const { body } of own) {
      expect(body).toContain('user_id = (SELECT auth.uid())');
      expect(body).not.toContain('owns_profile');
    }
  });

  it('leaves push_tokens and blocks on the account', () => {
    expect(rls).not.toMatch(/DROP POLICY "[^"]*" ON public\.(push_tokens|blocks)/);
  });

  it('checks both sides of the compound policies', () => {
    const byName = (name: string) => policies().find((p) => p.name === name)!.body;
    expect(byName('Stories visible to owner and followers')).toContain('(SELECT public.owns_profile(f.follower_id))');
    expect(byName('Viewers and owners can see story views')).toContain('(SELECT public.owns_profile(s.user_id))');
    expect(byName('Users can view own messages')).toContain(
      '(SELECT public.owns_profile(sender_id)) OR (SELECT public.owns_profile(receiver_id))',
    );
    expect(byName('Posts visible unless author is private')).toContain('(SELECT public.owns_profile(f.follower_id))');
  });

  it('moves the identity functions onto the account', () => {
    expect(rls).toContain('WHERE user_id = (SELECT auth.uid()) AND is_admin');
    expect(rls).toContain('JOIN auth.users u ON u.id = p.user_id');
    expect(rls).toContain('NOT (public.owns_profile(user1) OR public.owns_profile(user2))');
    expect(rls).toContain('NOT (public.owns_profile(user_id_1) OR public.owns_profile(user_id_2))');
  });
});

describe('storage stays on the auth user', () => {
  const storage = migration('_create_storage_bucket.sql');

  it('records the rule where the storage policies live', () => {
    expect(storage).toContain('media upload paths are keyed by the AUTH USER id, never by a');
  });

  it('keeps every storage policy on auth.uid()', () => {
    expect(statements(storage)).not.toContain('owns_profile');
    expect(statements(migration('_multi_profile_rls.sql'))).not.toContain('storage.objects');
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'rls_multi_profile.test.sql'), 'utf8');

  it.each([
    'an account with two profiles can edit both',
    "an account cannot edit another account''s profile",
    'a post by profile A is editable by its account while acting as profile B',
    'an account cannot post as a profile it does not own',
    "a block rejects a message from the blocked account''s business profile",
    'a block rejects a comment from the blocked account',
    'a second individual profile for the same account is rejected',
    'a business profile alongside the individual one is accepted',
    'the new profile has a fresh id, not the auth user id',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
