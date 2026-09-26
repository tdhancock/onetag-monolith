//
// target: __tests__/supabase/resolve-tag.test.ts
//
// The resolve_tag function (ONE-30).
//
// It reads past the tags table's RLS — the only way anyone but a tag's owner
// reads a tag (ONE-82) — so it may say no more than resolution
// needs: this suite pins that a paused tag reveals only that it is paused,
// and that anyone may call it. supabase/tests/resolve_tag.test.sql pins the
// behaviour against a real database; this suite checks it carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_resolve_tag.sql'));
if (!file) throw new Error('No *_resolve_tag.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

describe('resolve_tag', () => {
  it('is a read, with a pinned search_path', () => {
    expect(sql).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('looks a tag up by its short code alone', () => {
    expect(sql).toContain('WHERE t.short_code = p_short_code');
  });

  it('hides a paused tag\'s id and destination — every column but active is guarded', () => {
    for (const column of ['t.id', 't.dest_profile_id', 'p.username']) {
      expect(sql).toContain(`CASE WHEN t.active THEN ${column} END`);
    }
  });

  it('returns no post destination — a post is not one of the four kinds (ONE-83)', () => {
    expect(sql).not.toContain('dest_post_id');
  });

  it('may be called signed in or not', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;');
  });

  it('tells M5 to add its destinations here too', () => {
    expect(raw).toMatch(/M5 adds product and project destinations[\s\S]*must add them here/);
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'resolve_tag.test.sql'), 'utf8');

  it.each([
    "an anonymous caller resolves an active profile tag to its id and the profile''s handle",
    'an unknown code resolves to nothing',
    'a paused tag resolves as inactive, distinct from an unknown code',
    'a paused tag reveals neither its id nor where it points',
    'the table itself hides every tag from a stranger — resolve_tag is the only way in',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
