//
// target: __tests__/supabase/projects-rls.test.ts
//
// The projects, contributors and tag-destinations migration (ONE-38).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — the vocabulary, the
//      visibility rules for projects and contributor links, a contributor's
//      right to remove themselves, and tags completed with product and
//      project destinations everywhere a destination is read or checked — so
//      nobody loosens it later without the diff being obvious.
//   2. supabase/tests/projects.test.sql pins the *behaviour* against a real
//      database (`npm run db:test`, local stack), with resolve_tag.test.sql
//      and protect_tag_identity.test.sql extended for the new destinations.
//      This suite checks those files still carry each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const TESTS = join(ROOT, 'supabase', 'tests');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_projects_contributors.sql'));
if (!file) throw new Error('No *_projects_contributors.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

const policiesOn = (table: string): { name: string; body: string }[] => {
  const found: { name: string; body: string }[] = [];
  const pattern = new RegExp(`CREATE POLICY "([^"]+)" ON public\\.${table} (.*?);`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) found.push({ name: match[1], body: match[2] });
  return found;
};

const commandOf = (body: string) => body.match(/FOR (\w+)/)![1];

describe('vocabulary', () => {
  it('says Contributor, never vendor', () => {
    expect(raw).not.toMatch(/vendor/i);
    expect(sql).toContain('CREATE TABLE public.contributors');
  });
});

describe('projects', () => {
  it('carries the columns the ticket names, owned by either profile type', () => {
    for (const column of [
      'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      'owner_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE',
      'name TEXT NOT NULL',
      'project_type TEXT',
      'description TEXT',
      'cover_url TEXT',
      'year TEXT',
      'is_public BOOLEAN NOT NULL DEFAULT true',
      'created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
      'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/projects_require_business|profile_type = 'business'/);
  });

  it('carries the search groundwork, matching products', () => {
    expect(sql).toContain('ON public.projects USING GIN (search_vector)');
    expect(sql).toContain('BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()');
  });

  it('is indexed by owner, newest first', () => {
    expect(sql).toContain('ON public.projects (owner_profile_id, created_at DESC)');
  });
});

describe('contributors and project products', () => {
  it('link a profile to a project once', () => {
    expect(sql).toContain('contributor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE (project_id, contributor_profile_id)');
    expect(sql).toContain('added_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('link a product to a project once, cascading with either', () => {
    expect(sql).toContain('product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE (project_id, product_id)');
    expect(sql.match(/project_id UUID NOT NULL REFERENCES public\.projects\(id\) ON DELETE CASCADE/g)).toHaveLength(2);
  });

  it('are indexed for the reverse lookups', () => {
    expect(sql).toContain('ON public.contributors (contributor_profile_id)');
    expect(sql).toContain('ON public.project_products (product_id)');
  });
});

describe('RLS', () => {
  it.each(['projects', 'contributors', 'project_products'])('is enabled on %s', (table) => {
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  });

  it('shows a public project to anyone, and a private one only to its owner and contributors', () => {
    const reads = policiesOn('projects').filter((p) => commandOf(p.body) === 'SELECT');
    expect(reads.map((p) => p.body)).toEqual([
      'FOR SELECT TO anon, authenticated USING (is_public)',
      'FOR SELECT TO authenticated USING ((SELECT public.owns_profile(owner_profile_id)) OR public.is_project_contributor(id))',
    ]);
  });

  it('asks who contributes through a helper, so the two tables\' reads never recurse', () => {
    expect(sql).toMatch(
      /FUNCTION public\.is_project_contributor\(p_project_id UUID\) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''/,
    );
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.is_project_contributor(UUID) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.is_project_contributor(UUID) TO authenticated;');
  });

  it('gates project writes on the ownership helper', () => {
    const writes = policiesOn('projects').filter((p) => commandOf(p.body) !== 'SELECT');
    expect(writes.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const { body } of writes) expect(body).toContain('(SELECT public.owns_profile(owner_profile_id))');
  });

  it('shows a contributor link only where its project is visible — a hidden one to its owner and contributor alone', () => {
    const reads = policiesOn('contributors').filter((p) => commandOf(p.body) === 'SELECT');
    expect(reads).toHaveLength(2);
    expect(reads[0].body).toContain('TO anon, authenticated USING (is_public AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = contributors.project_id))');
    expect(reads[1].body).toContain('TO authenticated');
    expect(reads[1].body).toContain('(SELECT public.owns_profile(contributors.contributor_profile_id))');
  });

  it('leaves linking to the project owner, and lets a contributor remove themselves', () => {
    const policies = policiesOn('contributors');
    const byName = (name: string) => policies.find((p) => p.name === name)!;
    for (const name of ['Project owners can link contributors', 'Project owners can update contributor links', 'Project owners can unlink contributors']) {
      expect(byName(name).body).toContain('(SELECT public.owns_profile(p.owner_profile_id))');
    }
    expect(byName('Contributors can remove themselves').body).toBe(
      'FOR DELETE TO authenticated USING ((SELECT public.owns_profile(contributor_profile_id)))',
    );
    // Only the owner links anyone.
    const inserts = policies.filter((p) => commandOf(p.body) === 'INSERT');
    expect(inserts.map((p) => p.name)).toEqual(['Project owners can link contributors']);
  });

  it('shows a project\'s products with it, and leaves linking them to its owner', () => {
    const policies = policiesOn('project_products');
    expect(policies.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);
    const read = policies.find((p) => commandOf(p.body) === 'SELECT')!;
    expect(read.body).toContain('TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_products.project_id))');
  });
});

describe('tags, completed', () => {
  it('gain product and project destinations as real foreign keys, indexed for the cascade', () => {
    expect(sql).toContain('ADD COLUMN dest_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE');
    expect(sql).toContain('ADD COLUMN dest_project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE');
    expect(sql).toContain('ON public.tags (dest_product_id) WHERE dest_product_id IS NOT NULL');
    expect(sql).toContain('ON public.tags (dest_project_id) WHERE dest_project_id IS NOT NULL');
  });

  it('point at exactly one destination of the four kinds, and no post', () => {
    expect(sql).toContain('DROP CONSTRAINT tags_one_destination');
    expect(sql).toContain('CHECK (num_nonnulls(dest_profile_id, dest_product_id, dest_project_id) = 1)');
    expect(sql).toMatch(/COMMENT ON CONSTRAINT tags_one_destination ON public\.tags IS '[^']*four kinds/);
    expect(sql).not.toContain('dest_post_id');
  });

  it('may point only at a product or project the same account owns, on insert and on update', () => {
    const policies = policiesOn('tags');
    for (const command of ['INSERT', 'UPDATE']) {
      const policy = policies.find((p) => commandOf(p.body) === command)!;
      const check = policy.body.slice(policy.body.indexOf('WITH CHECK'));
      expect(check).toContain('(tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))');
      expect(check).toContain(
        'tags.dest_product_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))',
      );
      expect(check).toContain(
        'tags.dest_project_id IS NULL OR EXISTS ( SELECT 1 FROM public.projects p WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))',
      );
    }
  });

  it('adds no public read of the table — strangers still go through resolve_tag (ONE-82)', () => {
    expect(policiesOn('tags').filter((p) => commandOf(p.body) === 'SELECT')).toEqual([]);
  });

  it('freeze the new destination columns too (ONE-86)', () => {
    const trigger = sql.slice(sql.indexOf('FUNCTION public.protect_tag_identity()'));
    expect(trigger).toContain('NEW.dest_product_id IS DISTINCT FROM OLD.dest_product_id');
    expect(trigger).toContain('NEW.dest_project_id IS DISTINCT FROM OLD.dest_project_id');
  });

  it('resolve to products and projects, revealing nothing for a paused tag', () => {
    expect(sql).toContain('DROP FUNCTION public.resolve_tag(TEXT);');
    expect(sql).toContain('dest_product_id UUID, dest_project_id UUID ) LANGUAGE sql STABLE SECURITY DEFINER');
    expect(sql).toContain('CASE WHEN t.active THEN t.dest_product_id END');
    expect(sql).toContain('CASE WHEN t.active THEN t.dest_project_id END');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;');
  });
});

describe('the behavioural suites', () => {
  const projects = readFileSync(join(TESTS, 'projects.test.sql'), 'utf8');
  const resolveTag = readFileSync(join(TESTS, 'resolve_tag.test.sql'), 'utf8');
  const identity = readFileSync(join(TESTS, 'protect_tag_identity.test.sql'), 'utf8');

  it.each([
    'an individual profile creates a project — projects are not business-only',
    'an unrelated account cannot see a private project',
    'a contributor sees the private project they are linked to',
    'the project owner links a contributor',
    'an unrelated account cannot link a contributor',
    'a contributor removes themselves',
    'a contributor cannot link anyone else',
    'a profile is linked to a project once',
    'the destination check rejects two destinations',
    'the destination check still rejects zero destinations',
    "a user cannot create a tag pointing at another account''s product",
    "a tag cannot be re-pointed at another account''s product",
    'deleting a project removes its contributor links',
    'and its product links',
  ])('projects covers: %s', (description) => {
    expect(projects).toContain(description);
  });

  it.each([
    'an active product tag resolves to its product (ONE-38)',
    'a paused product tag reveals no product',
    'an active project tag resolves to its project',
  ])('resolve_tag covers: %s', (description) => {
    expect(resolveTag).toContain(description);
  });

  it('protect_tag_identity covers the project destination', () => {
    expect(identity).toContain('the owner cannot repoint the tag at a project the account owns either (ONE-38)');
  });
});
