//
// target: __tests__/supabase/scan-privacy.test.ts
//
// Scan History's privacy (ONE-35).
//
// Two layers, as rls-multi-profile.test.ts set:
//
//   1. This suite pins the *shape* of the migration — private by default, the
//      database (not the client) deciding who reads a scan, and a history read
//      that returns where tags led and nothing of the tags themselves.
//   2. supabase/tests/scan_history.test.sql is the API-level privacy suite:
//      every check reads as the role and account PostgREST would, against a
//      real database (`npm run db:test`, local stack). This suite checks that
//      file still carries each case the ticket names.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_scan_history.sql'));
if (!file) throw new Error('No *_scan_history.sql migration found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');

/** The SQL alone, comments stripped and whitespace collapsed. */
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

describe('the setting', () => {
  it('is private by default, so no existing profile is opted in', () => {
    expect(sql).toContain('ADD COLUMN scan_history_public BOOLEAN NOT NULL DEFAULT false');
    expect(sql).not.toMatch(/UPDATE public\.profiles/);
  });
});

describe('who reads a scan', () => {
  it('adds one case to the scans read: a scanner whose history is public, checked live in RLS', () => {
    expect(sql).toContain(
      'CREATE POLICY "Public scan histories are viewable by everyone" ON public.scans FOR SELECT TO anon, authenticated USING (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = scans.scanner_profile_id AND p.scan_history_public ))',
    );
  });

  it('opens nothing to a tag\'s owner (ONE-82)', () => {
    expect(sql).not.toContain('owner_profile_id))');
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(1);
  });
});

describe('scan_history', () => {
  const fn = sql.slice(sql.indexOf('FUNCTION public.scan_history'), sql.indexOf('REVOKE ALL ON FUNCTION public.scan_history'));

  it('is a read, with a pinned search_path', () => {
    expect(fn).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''/);
    expect(fn).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('returns where each tag led and how often — never the tag\'s id, name or note', () => {
    expect(fn).toContain(
      'RETURNS TABLE ( dest_kind TEXT, dest_id UUID, dest_name TEXT, dest_username TEXT, scan_count BIGINT, last_scanned_at TIMESTAMPTZ )',
    );
    expect(fn).not.toMatch(/t\.name|t\.note|t\.id\b(?! =)/);
  });

  it('answers only for the caller\'s own history or a public one', () => {
    expect(fn).toContain('public.owns_profile(p_profile_id) OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = p_profile_id AND me.scan_history_public)');
  });

  it('shows a private project only to someone who could see it', () => {
    expect(fn).toContain(
      't.dest_project_id IS NULL OR pj.is_public OR public.owns_profile(pj.owner_profile_id) OR public.is_project_contributor(pj.id)',
    );
  });

  it('collapses repeats in the display, keeping every scan in the data', () => {
    expect(fn).toContain('count(*), max(h.scanned_at)');
    expect(fn).toContain('GROUP BY h.dest_kind, h.dest_id, h.dest_name, h.dest_username');
  });

  it('is open to anyone, since a public history is public', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.scan_history(UUID) FROM PUBLIC;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.scan_history(UUID) TO anon, authenticated;');
  });
});

describe('the API-level privacy suite', () => {
  const pgTap = readFileSync(join(ROOT, 'supabase', 'tests', 'scan_history.test.sql'), 'utf8');

  it.each([
    "a newly created profile''s scan history is private",
    "another account reads none of a private history''s scans through the API",
    'once public, another account reads its scans through the API',
    'closed, another account reads none of its scans — the ones it saw before included',
    'the scanner reads every scan of their own, whatever the setting',
    'the same tag scanned ten times is one entry, counting 10, with the latest time',
    'the owner of the tags scanned reads no private scans of them (ONE-82)',
    "the history never carries a tag''s own name or note",
  ])('covers: %s', (description) => {
    expect(pgTap).toContain(description);
  });
});
