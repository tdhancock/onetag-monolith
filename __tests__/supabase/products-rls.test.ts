//
// target: __tests__/supabase/products-rls.test.ts
//
// The products migration (ONE-37).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — no commerce columns, a
//      business-only guard, public reads and owner-only writes through the
//      ownership helper, and the search groundwork — so nobody loosens it
//      later without the diff being obvious.
//   2. supabase/tests/products.test.sql pins the *behaviour* against a real
//      database (`npm run db:test`, local stack). This suite checks that file
//      still carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_products.sql'));
if (!file) throw new Error('No *_products.sql migration found');
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

describe('products', () => {
  it('belongs to a profile, and carries the columns the ticket names', () => {
    for (const column of [
      'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      'business_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE',
      'name TEXT NOT NULL',
      'description TEXT',
      'category TEXT',
      'price_cents INTEGER',
      "currency TEXT NOT NULL DEFAULT 'USD'",
      'available BOOLEAN NOT NULL DEFAULT true',
      'sku TEXT',
      'created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
      'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('is not a thing you can buy: no commerce columns', () => {
    expect(sql).not.toMatch(/purchase_type|affiliate|commission|stock|inventory|checkout|cart|order_/i);
  });

  it('lets only a business profile list one', () => {
    expect(sql).toContain("WHERE id = NEW.business_profile_id AND profile_type = 'business'");
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF business_profile_id ON public.products');
  });

  it('stamps updated_at in the database', () => {
    expect(sql).toContain('NEW.updated_at := now();');
    expect(sql).toContain('BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()');
  });

  it('carries a weighted tsvector over the name and description, GIN-indexed', () => {
    expect(sql).toContain('search_vector tsvector GENERATED ALWAYS AS');
    expect(sql).toContain("setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A')");
    expect(sql).toContain("setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')");
    expect(sql).toContain('ON public.products USING GIN (search_vector)');
  });

  it('is indexed as the ticket asks', () => {
    expect(sql).toContain('ON public.products (business_profile_id, created_at DESC)');
    expect(sql).toContain('ON public.products (category)');
    expect(sql).toContain('ON public.product_media (product_id, sort_order)');
    expect(sql).toContain('ON public.product_specs (product_id, sort_order)');
  });
});

describe('media and specs', () => {
  it('cascade with their product', () => {
    expect(sql.match(/product_id UUID NOT NULL REFERENCES public\.products\(id\) ON DELETE CASCADE/g)).toHaveLength(2);
  });

  it('media is a photo or a video, ordered', () => {
    expect(sql).toContain("media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video'))");
    expect(sql).toContain('sort_order INTEGER NOT NULL DEFAULT 0');
  });
});

describe('RLS', () => {
  it.each(['products', 'product_media', 'product_specs'])('is enabled on %s', (table) => {
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  });

  it.each(['products', 'product_media', 'product_specs'])('lets anyone, signed in or not, read %s', (table) => {
    const reads = policiesOn(table).filter((p) => commandOf(p.body) === 'SELECT');
    expect(reads).toHaveLength(1);
    expect(reads[0].body).toContain('TO anon, authenticated USING (true)');
  });

  it('gates every product write on owning the business profile, for signed-in callers only', () => {
    const writes = policiesOn('products').filter((p) => commandOf(p.body) !== 'SELECT');
    expect(writes.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const { body } of writes) {
      expect(body).toContain('TO authenticated');
      expect(body).toContain('(SELECT public.owns_profile(business_profile_id))');
      expect(body).not.toContain('anon');
    }
  });

  it.each(['product_media', 'product_specs'])('gates every %s write on owning its product', (table) => {
    const writes = policiesOn(table).filter((p) => commandOf(p.body) !== 'SELECT');
    expect(writes.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const { body } of writes) {
      expect(body).toContain('TO authenticated');
      expect(body).toContain(
        `EXISTS ( SELECT 1 FROM public.products p WHERE p.id = ${table}.product_id AND (SELECT public.owns_profile(p.business_profile_id)) )`,
      );
    }
  });
});

describe('storage', () => {
  it('says product images go in post-media, keyed by the auth user id', () => {
    expect(raw).toContain('`post-media` bucket under a');
    expect(raw).toMatch(/products\/<auth user id>/);
    expect(sql).not.toMatch(/INSERT INTO storage\.buckets/);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'products.test.sql'), 'utf8');

  it.each([
    'an individual profile cannot list a product',
    'a business owner lists a product, with no price',
    'a null price is valid: no price shown, in USD, available',
    'the owner adds media to their own product',
    "another account cannot list a product on A''s business",
    "another account cannot add media to A''s product",
    "another account cannot add a spec to A''s product",
    "another account cannot update A''s product",
    'an anonymous client reads a product',
    'an anonymous client cannot insert a product',
    'the tsvector is populated from the name and description',
    'deleting a product removes its media',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
