//
// target: __tests__/supabase/tags-rls.test.ts
//
// The tags and scans migration (ONE-27).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — real destination
//      foreign keys with an exactly-one check, a database-side short-code
//      generator drawing from the same alphabet as lib/tagLinks.ts, and RLS
//      that lets a stranger resolve a tag and record a scan but nothing more
//      — so nobody loosens it later without the diff being obvious.
//   2. supabase/tests/tags_and_scans.test.sql pins the *behaviour* against a
//      real database (`npm run db:test`, local stack), including the 10,000
//      generated codes. This suite checks that file still carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TAG_SHORT_CODE_ALPHABET, TAG_SHORT_CODE_LENGTH, isValidShortCode } from '../../lib/tagLinks';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_tags_and_scans.sql'));
if (!file) throw new Error('No *_tags_and_scans.sql migration found');
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

describe('tags', () => {
  it('points at its destination through real foreign keys, not a polymorphic pair', () => {
    expect(sql).toContain('dest_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(sql).not.toMatch(/dest_type|dest_id\b/);
  });

  it('has no post destination — a post is not one of the four kinds (ONE-83)', () => {
    expect(sql).not.toContain('dest_post_id');
  });

  it('has exactly one destination, and says M5 must extend the check', () => {
    expect(sql).toContain('CONSTRAINT tags_one_destination CHECK (num_nonnulls(dest_profile_id) = 1)');
    expect(raw).toMatch(/M5 MUST extend this check/);
    expect(sql).toMatch(/COMMENT ON CONSTRAINT tags_one_destination ON public\.tags IS '[^']*M5 must extend/);
  });

  it('carries the columns the ticket names', () => {
    for (const column of [
      'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      'owner_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE',
      "tag_type TEXT NOT NULL CHECK (tag_type IN ('physical', 'digital', 'embedded'))",
      "format TEXT CHECK (format IN ('qr'))",
      'name TEXT',
      'note TEXT',
      'active BOOLEAN NOT NULL DEFAULT true',
      'short_code TEXT NOT NULL UNIQUE DEFAULT public.gen_short_code()',
      'created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('defers Embedded Tag positions to M6', () => {
    expect(sql).not.toMatch(/tag_x_pct|tag_y_pct|host_post_id/);
  });

  it('indexes the owner and the cascading destination', () => {
    expect(sql).toContain('CREATE INDEX tags_owner_profile_id ON public.tags (owner_profile_id)');
    expect(sql).toContain('ON public.tags (dest_profile_id)');
  });
});

describe('short codes', () => {
  const alphabetInSql = sql.match(/alphabet CONSTANT TEXT := '([^']+)'/)?.[1];

  it('are generated from exactly the alphabet lib/tagLinks.ts parses', () => {
    expect(alphabetInSql).toBe(TAG_SHORT_CODE_ALPHABET);
  });

  it('omit 0, O, 1, I and l', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'l']) {
      expect(alphabetInSql).not.toContain(ambiguous);
    }
  });

  it(`are ${TAG_SHORT_CODE_LENGTH} characters, and the column refuses any other shape`, () => {
    expect(sql).toContain('WHILE char_length(candidate) < 8 LOOP');
    expect(sql).toContain(`CHECK (short_code ~ '^[${TAG_SHORT_CODE_ALPHABET}]{${TAG_SHORT_CODE_LENGTH}}$')`);
  });

  it('draw on cryptographic randomness without modulo bias', () => {
    expect(sql).toContain('extensions.gen_random_bytes(');
    expect(sql).not.toMatch(/\brandom\(\)/);
    // 57 × 4: the largest multiple of the alphabet that fits in a byte.
    expect(TAG_SHORT_CODE_ALPHABET).toHaveLength(57);
    expect(sql).toContain('byte_limit CONSTANT INT := 228;');
    expect(sql).toContain('IF b < byte_limit');
  });

  it('retry on collision, checking every tag rather than the ones RLS shows', () => {
    expect(sql).toContain('IF NOT EXISTS (SELECT 1 FROM public.tags WHERE short_code = candidate) THEN RETURN candidate;');
    expect(sql).toMatch(/FUNCTION public\.gen_short_code\(\) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''/);
  });

  it('can be generated only by signed-in callers', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.gen_short_code() FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.gen_short_code() TO authenticated;');
  });

  it('agree with isValidShortCode', () => {
    expect(isValidShortCode('ABC23XYZ')).toBe(true);
    expect(isValidShortCode('O0l1I234')).toBe(false);
  });
});

describe('scans', () => {
  it('reference the tag, and the scanner only nullably', () => {
    expect(sql).toContain('tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE');
    expect(sql).toContain('scanner_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL');
    expect(sql).toContain('scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('are indexed for a tag and for a scanner, newest first', () => {
    expect(sql).toContain('ON public.scans (tag_id, scanned_at DESC)');
    expect(sql).toContain('ON public.scans (scanner_profile_id, scanned_at DESC)');
  });
});

describe('RLS on tags', () => {
  const policies = policiesOn('tags');

  it('is enabled', () => {
    expect(sql).toContain('ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY');
  });

  it('lets anyone, signed in or not, read an active tag', () => {
    const read = policies.find((p) => p.name === 'Active tags are viewable by everyone')!;
    expect(read.body).toContain('FOR SELECT TO anon, authenticated USING (active)');
  });

  it('lets owners read their paused tags too', () => {
    const own = policies.find((p) => p.name === 'Owners can view own tags')!;
    expect(own.body).toContain('FOR SELECT TO authenticated USING ((SELECT public.owns_profile(owner_profile_id)))');
  });

  it('gates every write on the ownership helper, for signed-in callers only', () => {
    const writes = policies.filter((p) => commandOf(p.body) !== 'SELECT');
    expect(writes.map((p) => commandOf(p.body)).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const { body } of writes) {
      expect(body).toContain('TO authenticated');
      expect(body).not.toContain('anon');
      expect(body).toContain('(SELECT public.owns_profile(owner_profile_id))');
    }
  });

  it('requires the destination to be the same account\'s, on insert and on update', () => {
    for (const command of ['INSERT', 'UPDATE']) {
      const policy = policies.find((p) => commandOf(p.body) === command)!;
      const check = policy.body.slice(policy.body.indexOf('WITH CHECK'));
      expect(check).toContain('(tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))');
    }
  });
});

describe('RLS on scans', () => {
  const policies = policiesOn('scans');

  it('is enabled', () => {
    expect(sql).toContain('ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY');
  });

  it('lets anyone record a scan — attributed to nobody or to a profile they own, of a tag they can read', () => {
    const insert = policies.find((p) => commandOf(p.body) === 'INSERT')!;
    expect(insert.body).toContain('TO anon, authenticated');
    expect(insert.body).toContain('scans.scanner_profile_id IS NULL OR (SELECT public.owns_profile(scans.scanner_profile_id))');
    expect(insert.body).toContain('EXISTS (SELECT 1 FROM public.tags t WHERE t.id = scans.tag_id)');
  });

  it('shows a scan to its scanner and to the tag\'s owner, and to nobody signed out', () => {
    const reads = policies.filter((p) => commandOf(p.body) === 'SELECT');
    expect(reads).toHaveLength(2);
    for (const { body } of reads) expect(body).toContain('TO authenticated');
    expect(reads.map((p) => p.body).join(' ')).toContain('(SELECT public.owns_profile(scanner_profile_id))');
    expect(reads.map((p) => p.body).join(' ')).toContain(
      'WHERE t.id = scans.tag_id AND (SELECT public.owns_profile(t.owner_profile_id))',
    );
  });

  it('is append-only: no update or delete policy', () => {
    expect(policies.map((p) => commandOf(p.body)).sort()).toEqual(['INSERT', 'SELECT', 'SELECT']);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'tags_and_scans.test.sql'), 'utf8');

  it.each([
    'a tag inserted without a short_code gets an 8-character one',
    'each tag gets its own short code',
    'an anonymous client can read an active tag by short_code',
    'an anonymous client can insert a scan with a null scanner_profile_id',
    'an anonymous client cannot insert a tag',
    'a user cannot create a tag pointing at a profile they do not own',
    'a post is not a Destination (ONE-83)',
    'a tag cannot be re-pointed at a profile its owner does not own',
    'a tag owner can see every scan of its tag, anonymous ones included',
    'a tag owner sees scans of its own tags and no others',
    'an unrelated user cannot see scans of the tag',
    'nobody can forge a scan attributed to another profile',
    'the destination check rejects zero destinations',
    '10,000 generated codes are all 8 characters',
    '10,000 generated codes contain none of 0, O, 1, I or l',
    '10,000 generated codes produce no duplicates',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
