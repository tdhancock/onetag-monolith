//
// target: __tests__/supabase/business-profiles.test.ts
//
// The business_profiles migration (ONE-23).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — the table keyed on the
//      profile, the type guard, and every policy going through the ownership
//      helper — so nobody loosens it later without the diff being obvious.
//   2. supabase/tests/business_profiles.test.sql pins the *behaviour* against
//      a real database (`npm run db:test`, local stack): the guard rejects a
//      row for an individual profile; the owner updates the category and
//      another account cannot. This suite checks that file still carries
//      each of those cases.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_business_profiles.sql'));
if (!file) throw new Error('No *_business_profiles.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

const policies = (): { name: string; body: string }[] => {
  const found: { name: string; body: string }[] = [];
  const pattern = /CREATE POLICY "([^"]+)" ON public\.business_profiles(.*?);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) found.push({ name: match[1], body: match[2] });
  return found;
};

describe('the table', () => {
  it('extends a profile one-to-one: its primary key is the foreign key', () => {
    expect(sql).toContain(
      'profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE',
    );
  });

  it('carries the four business fields and a creation time', () => {
    for (const column of ['category TEXT', 'website TEXT', 'location TEXT', 'logo_url TEXT']) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('keeps anything but a web link out of the website', () => {
    expect(sql).toContain("CHECK (website IS NULL OR website ~* '^https?://");
  });

  it('is not the polymorphic handoff table', () => {
    expect(sql).not.toMatch(/owner_type|owner_id/);
  });

  it('adds no storage bucket — a logo lives in avatars', () => {
    expect(sql).not.toContain('storage.buckets');
    expect(sql).not.toContain('storage.objects');
  });
});

describe('the type guard', () => {
  it('refuses a row unless its profile is a business profile', () => {
    expect(sql).toContain("WHERE id = NEW.profile_id AND profile_type = 'business'");
    expect(sql).toContain("ERRCODE = '23514'");
  });

  it('runs on insert and on any re-pointing update, with a pinned search_path', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF profile_id ON public.business_profiles');
    expect(sql).toContain("SET search_path = ''");
  });
});

describe('RLS', () => {
  it('is enabled', () => {
    expect(sql).toContain('ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY');
  });

  it('lets everyone read, signed in or not', () => {
    const read = policies().find((p) => p.body.includes('FOR SELECT'));
    expect(read?.body).toContain('TO anon, authenticated USING (true)');
  });

  it('gates every write on the ownership helper, never straight on auth.uid()', () => {
    const writes = policies().filter((p) => !p.body.includes('FOR SELECT'));
    expect(writes.map((p) => p.body.match(/FOR (\w+)/)![1]).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const { body } of writes) {
      expect(body).toContain('TO authenticated');
      expect(body).toContain('(SELECT public.owns_profile(profile_id))');
      expect(body).not.toContain('auth.uid()');
    }
  });

  it('checks both sides of an update', () => {
    const update = policies().find((p) => p.body.includes('FOR UPDATE'))!;
    expect(update.body).toMatch(/USING \(\(SELECT public\.owns_profile\(profile_id\)\)\) WITH CHECK/);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'business_profiles.test.sql'), 'utf8');

  it.each([
    'a business row for an individual profile is rejected',
    'a business row cannot be re-pointed at an individual profile',
    'the owner can update the category',
    'another account cannot update the category',
    'another account cannot delete the business fields',
    'business fields are readable without signing in',
    'a website without a scheme is rejected',
    // Adding a business profile as the app does it (ONE-26).
    'a created business profile has both its profiles row and its business row',
    'a second business profile for the same account hits the one-of-each index',
    'a handle already held, in any case, hits the handle index',
    'an account cannot add a profile to another account',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
