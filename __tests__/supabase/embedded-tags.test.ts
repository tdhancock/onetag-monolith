//
// target: __tests__/supabase/embedded-tags.test.ts
//
// Embedded Tags (ONE-44): a tag pinned to a point on a post's image.
//
// supabase/tests/embedded_tags.test.sql pins the behaviour against a real
// database; this suite pins the migration's shape and that the behavioural
// suite carries each case the ticket names.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_embedded_tags.sql'));
if (!file) throw new Error('No *_embedded_tags.sql migration found');
const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ');

describe('the embedded tags migration', () => {
  it('adds the host post, cascading, and a percentage position', () => {
    expect(sql).toContain('ADD COLUMN host_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE');
    expect(sql).toContain('ADD COLUMN tag_x_pct NUMERIC(5,2)');
    expect(sql).toContain('ADD COLUMN tag_y_pct NUMERIC(5,2)');
  });

  it('requires all three for an embedded tag and none for any other', () => {
    expect(sql).toMatch(
      /CASE WHEN tag_type = 'embedded' THEN num_nonnulls\(host_post_id, tag_x_pct, tag_y_pct\) = 3 ELSE num_nonnulls\(host_post_id, tag_x_pct, tag_y_pct\) = 0 END/,
    );
  });

  it('bounds both coordinates to 0–100', () => {
    expect(sql).toContain('CHECK (tag_x_pct BETWEEN 0 AND 100)');
    expect(sql).toContain('CHECK (tag_y_pct BETWEEN 0 AND 100)');
  });

  it('forbids a format or a note on an embedded tag', () => {
    expect(sql).toContain("tag_type <> 'embedded' OR (format IS NULL AND note IS NULL)");
  });

  it('indexes the host post', () => {
    expect(sql).toMatch(/CREATE INDEX tags_host_post_id ON public\.tags \(host_post_id\)/);
  });

  it('reads an embedded tag through its post, under the caller\'s RLS', () => {
    expect(sql).toMatch(
      /"Embedded tags are viewable with their post"[^;]*EXISTS \(SELECT 1 FROM public\.posts p WHERE p\.id = tags\.host_post_id\)/,
    );
  });

  it('keeps the own-destinations rule for Physical and Digital Tags only', () => {
    for (const policy of ['Users can create tags to own destinations', 'Users can update own tags']) {
      const body = sql.split(`CREATE POLICY "${policy}"`)[1].split(';')[0];
      expect(body).toContain("tags.tag_type <> 'embedded'");
    }
  });

  it('lets only the host post\'s author embed a tag, and only at a public project', () => {
    const body = sql.split('CREATE POLICY "Authors can embed tags in own posts"')[1].split(';')[0];
    expect(body).toContain('p.id = tags.host_post_id AND p.user_id = tags.owner_profile_id');
    expect(body).toContain('p.id = tags.dest_project_id AND p.is_public');
  });

  it('lets a tagged destination\'s owner remove the tag', () => {
    expect(sql).toContain('CREATE POLICY "Tagged destinations can remove embedded tags" ON public.tags FOR DELETE');
  });

  it('makes resolve_tag refuse embedded tags, keeping its grants', () => {
    expect(sql).toContain("WHERE t.short_code = p_short_code AND t.tag_type <> 'embedded'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;');
  });

  it('adds no post destination — a post is not one of the four kinds (ONE-83)', () => {
    expect(sql).not.toContain('dest_post_id');
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'embedded_tags.test.sql'), 'utf8');

  it.each([
    'an embedded tag without both coordinates is rejected',
    'a physical tag with coordinates is rejected',
    'an out-of-range percentage is rejected',
    'an embedded tag with a note is rejected',
    'deleting a host post removes its embedded tags',
    "an embedded tag on a post the viewer can''t see is not readable",
    "the post''s author can tag another account''s product",
    'nobody but the author can add a tag to the post',
    "a private project can''t be tagged",
    "the tagged profile''s owner removed the tag pointing at them",
    "resolve_tag returns nothing for an embedded tag''s code",
    'a tap is recorded as an ordinary scan',
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});

describe('the follow-ups (ONE-93, ONE-94)', () => {
  const followups = readdirSync(MIGRATIONS).find((name) => name.endsWith('_embedded_tag_followups.sql'));
  if (!followups) throw new Error('No *_embedded_tag_followups.sql migration found');
  const body = readFileSync(join(MIGRATIONS, followups), 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ');

  it('freezes an embedded tag\'s host post with the rest of its identity', () => {
    expect(body).toContain('IF NEW.host_post_id IS DISTINCT FROM OLD.host_post_id THEN');
    for (const column of ['short_code', 'dest_profile_id', 'dest_product_id', 'dest_project_id', 'tag_type', 'owner_profile_id']) {
      expect(body).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
  });

  it('keeps taps on post tags out of Scan History, and its grants as they were', () => {
    expect(body).toContain("WHERE s.scanner_profile_id = p_profile_id AND t.tag_type <> 'embedded'");
    expect(body).toContain('GRANT EXECUTE ON FUNCTION public.scan_history(UUID) TO anon, authenticated;');
  });
});
