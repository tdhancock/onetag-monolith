//
// target: __tests__/supabase/blank-tags.test.ts
//
// Blank Physical Tags (ONE-135): printed with no destination, Linked once,
// later. What ONE-86 froze stays frozen once a tag has a destination, so the
// migration may relax exactly one thing — the first link, from none to one —
// and this suite pins that it relaxes nothing else. supabase/tests/
// blank_tags.test.sql pins the behaviour against a real database; this suite
// checks it carries each case.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_blank_tags.sql'));
if (!file) throw new Error('No *_blank_tags.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

const DESTINATIONS = 'dest_profile_id, dest_product_id, dest_project_id, dest_post_id';

/** The body of one function, from its CREATE to the end of its definition. */
const functionBody = (name: string): string => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`no ${name} in the migration`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

describe('tags_one_destination', () => {
  it('allows no destination for a Physical Tag only, and exactly one for every tag otherwise', () => {
    expect(sql).toContain(
      `CHECK ( num_nonnulls(${DESTINATIONS}) = 1 OR (tag_type = 'physical' AND num_nonnulls(${DESTINATIONS}) = 0) )`,
    );
  });
});

describe('protect_tag_identity', () => {
  const body = functionBody('protect_tag_identity');

  it('lets a destination change only from none to exactly one', () => {
    expect(body).toContain(`num_nonnulls(OLD.dest_profile_id, OLD.dest_product_id, OLD.dest_project_id, OLD.dest_post_id) = 0`);
    expect(body).toContain(`num_nonnulls(NEW.dest_profile_id, NEW.dest_product_id, NEW.dest_project_id, NEW.dest_post_id) = 1`);
    expect(body).toMatch(/OR NEW\.dest_post_id IS DISTINCT FROM OLD\.dest_post_id\) AND NOT linking THEN/);
  });

  it('still freezes the short code, host post, type and owner', () => {
    for (const column of ['short_code', 'host_post_id', 'tag_type', 'owner_profile_id']) {
      expect(body).toContain(`IF NEW.${column} IS DISTINCT FROM OLD.${column} THEN`);
    }
  });

  it('runs no check for the database owner, as before', () => {
    expect(body).toMatch(/IF privileged THEN RETURN NEW; END IF;/);
  });
});

describe('tag_accepts_scans', () => {
  it('takes a Scan only for an active tag with a destination', () => {
    expect(functionBody('tag_accepts_scans')).toContain(`AND active AND num_nonnulls(${DESTINATIONS}) = 1`);
  });
});

describe('resolve_tag', () => {
  const body = functionBody('resolve_tag');

  it('is still a read, callable signed in or not', () => {
    expect(body).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''/);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;');
  });

  it('says whether a tag is linked, and whether the caller owns it', () => {
    expect(body).toContain('linked BOOLEAN, owned_by_caller BOOLEAN');
    expect(body).toContain('public.owns_profile(tags.owner_profile_id) AS is_owned');
  });

  it('gives a blank tag\'s id to its owner alone, and nothing of a paused tag', () => {
    expect(body).toContain('WHEN NOT t.active THEN NULL WHEN t.is_linked OR t.is_owned THEN t.id');
    for (const column of ['t.dest_profile_id', 't.dest_product_id', 't.dest_project_id', 't.dest_post_id', 't.is_linked', 't.is_owned']) {
      expect(body).toContain(`CASE WHEN t.active THEN ${column} END`);
    }
  });

  it('still never resolves an Embedded Tag', () => {
    expect(body).toContain("tags.tag_type <> 'embedded'");
  });
});

describe('the behavioural suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'blank_tags.test.sql'), 'utf8');

  it.each([
    'an account can create a Physical Tag with no destination',
    "a Digital Tag can''t be blank: it is shared from its destination",
    "an Embedded Tag can''t be blank, even written by the database owner",
    'the owner links a blank tag to a project the account owns',
    "once linked, the tag can''t be repointed at another of the account''s projects",
    "a blank tag can''t be linked to two destinations at once",
    "a blank tag can''t be linked to a product another account lists",
    "another account can''t link someone else''s blank tag",
    'resolve_tag tells the owner a blank tag is theirs and unlinked, with its id to link it by',
    "another account learns only that a blank tag isn''t set up: not its id",
    "a stranger learns only that a blank tag isn''t set up",
    'a paused blank tag reveals nothing, not even that it is blank',
    "a stranger''s Scan of a blank tag is refused: there is nowhere it was scanned to",
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
