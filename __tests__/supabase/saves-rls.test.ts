//
// target: __tests__/supabase/saves-rls.test.ts
//
// The saves migration (ONE-39).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — one real foreign key per
//      kind of target with an exactly-one check, a partial unique index per
//      kind, saved_posts moved across and counted before it is dropped, and
//      saves private to the profile that made them.
//   2. supabase/tests/saves.test.sql pins the *behaviour* against a real
//      database (`npm run db:test`, local stack). This suite checks that file
//      still carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_generalize_saves.sql'));
if (!file) throw new Error('No *_generalize_saves.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

const policies = (): { name: string; body: string }[] => {
  const found: { name: string; body: string }[] = [];
  const pattern = /CREATE POLICY "([^"]+)" ON public\.saves (.*?);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) found.push({ name: match[1], body: match[2] });
  return found;
};

const commandOf = (body: string) => body.match(/FOR (\w+)/)![1];

const TARGETS = [
  ['saved_post_id', 'posts'],
  ['saved_product_id', 'products'],
  ['saved_project_id', 'projects'],
  ['saved_profile_id', 'profiles'],
] as const;

describe('saves', () => {
  it('belongs to a profile, not an account', () => {
    expect(sql).toContain('profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(sql).not.toMatch(/\buser_id UUID/);
  });

  it.each(TARGETS)('points at a target through a real foreign key: %s', (column, table) => {
    expect(sql).toContain(`${column} UUID REFERENCES public.${table}(id) ON DELETE CASCADE`);
  });

  it('has exactly one target — not a polymorphic type and id pair', () => {
    expect(sql).toContain(
      'CHECK (num_nonnulls(saved_post_id, saved_product_id, saved_project_id, saved_profile_id) = 1)',
    );
    expect(sql).not.toMatch(/saved_type|saved_id\b/);
  });

  it.each(TARGETS)('lets a profile save a target once, with a partial unique index: %s', (column) => {
    expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX \\w+ ON public\\.saves \\(profile_id, ${column}\\) WHERE ${column} IS NOT NULL`));
  });

  it.each(TARGETS)('is indexed for the reverse lookup: %s', (column) => {
    expect(sql).toMatch(new RegExp(`CREATE INDEX \\w+ ON public\\.saves \\(${column}\\) WHERE ${column} IS NOT NULL`));
  });

  it("lists a profile's saves newest first", () => {
    expect(sql).toContain('ON public.saves (profile_id, saved_at DESC)');
  });
});

describe('moving saved_posts across', () => {
  it('copies every row, profile and post and time, before anything is dropped', () => {
    const copy = sql.indexOf('INSERT INTO public.saves (profile_id, saved_post_id, saved_at) SELECT user_id, post_id, created_at FROM public.saved_posts;');
    const check = sql.indexOf("RAISE EXCEPTION 'saved_posts held % rows but saves received %; not dropping it'");
    const drop = sql.indexOf('DROP TABLE public.saved_posts;');
    expect(copy).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(copy);
    expect(drop).toBeGreaterThan(check);
  });

  it('counts both sides before the drop', () => {
    expect(sql).toContain('SELECT count(*) INTO held FROM public.saved_posts;');
    expect(sql).toContain('SELECT count(*) INTO copied FROM public.saves WHERE saved_post_id IS NOT NULL;');
    expect(sql).toContain('IF copied <> held THEN');
  });
});

describe('RLS', () => {
  it('is enabled', () => {
    expect(sql).toContain('ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY');
  });

  it('keeps saves private: read, save and unsave only as a profile you own, signed in', () => {
    const all = policies();
    expect(all.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);
    for (const { body } of all) {
      expect(body).toContain('TO authenticated');
      expect(body).toContain('(SELECT public.owns_profile(profile_id))');
      expect(body).not.toContain('anon');
    }
  });

  it('has no update policy: a save has nothing to edit', () => {
    expect(policies().some((p) => commandOf(p.body) === 'UPDATE')).toBe(false);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'saves.test.sql'), 'utf8');

  it.each([
    'a profile saves a post',
    'a post already saved by a profile cannot be saved again',
    'the check rejects a save with no target',
    'the check rejects a save with two targets',
    "another account cannot read a profile''s saves",
    'deleting a saved product removes the save',
    'saved_posts is gone, its rows moved to saves',
    "the account''s other profile saves the same post: saves belong to a profile",
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
