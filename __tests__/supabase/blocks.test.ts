//
// target: __tests__/supabase/blocks.test.ts
//
// The blocks migration and the RLS that makes a block mean something
// (ONE-54). Blocking used to be a Set of usernames in AsyncStorage: it hid
// people from lists this device rendered and stopped them doing nothing at
// all. The safety properties now live in the database, so this suite pins the
// shape of the migration that carries them.
//
// These are static assertions over the SQL, because Jest here runs in a plain
// node environment with no Postgres. The behaviour itself was verified
// against a local stack while the ticket was worked — as user B, blocked by
// A: inserting a message to A and a comment on A's post both raised "new row
// violates row-level security policy", `select count(*) from blocks` returned
// 0, and messaging an unrelated user D still succeeded; as A, the block row
// was visible, messaging B still worked (a block is one-directional),
// blocking themselves hit the check constraint, and inserting a block on
// someone else's behalf was refused.
//
// What this suite is really guarding is that nobody quietly loosens one of
// those policies later without the diff being obvious.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

const blocksMigration = (): string => {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_blocks.sql'));
  if (!file) throw new Error('No *_blocks.sql migration found');
  return readFileSync(join(MIGRATIONS, file), 'utf8');
};

/** Collapse whitespace so assertions do not depend on formatting. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

describe('blocks table', () => {
  const sql = flat(blocksMigration());

  it('keys a block on two auth users, cascading when either is deleted', () => {
    expect(sql).toContain('blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(sql).toContain('blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
  });

  it('makes a block unique per pair', () => {
    expect(sql).toContain('PRIMARY KEY (blocker_id, blocked_id)');
  });

  it('refuses a self-block', () => {
    expect(sql).toContain('CHECK (blocker_id <> blocked_id)');
  });

  it('indexes the direction the enforcement policies read', () => {
    // "Has this person blocked me" scans by blocked_id; the primary key only
    // serves the other direction.
    expect(sql).toContain('CREATE INDEX idx_blocks_blocked ON public.blocks (blocked_id)');
  });

  it('records when the block was made', () => {
    expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });
});

describe('blocks RLS', () => {
  const sql = flat(blocksMigration());

  it('enables row level security', () => {
    expect(sql).toContain('ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY');
  });

  it.each([
    ['SELECT', 'FOR SELECT TO authenticated USING (blocker_id = (SELECT auth.uid()))'],
    ['INSERT', 'FOR INSERT TO authenticated WITH CHECK (blocker_id = (SELECT auth.uid()))'],
    ['DELETE', 'FOR DELETE TO authenticated USING (blocker_id = (SELECT auth.uid()))'],
  ])('scopes %s to the blocker', (_command, clause) => {
    expect(sql).toContain(clause);
  });

  it('never lets the blocked party read rows naming them', () => {
    // Being able to see who blocked you is an information leak and an
    // invitation to retaliate. No *policy on blocks* may grant access by
    // matching the caller against blocked_id — the definer function below
    // does compare against it, which is exactly the point: the answer is
    // reachable inside a policy without being readable by the person asking.
    const policies = sql.match(/CREATE POLICY [^;]*ON public\.blocks[^;]*/g) ?? [];

    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(policy).not.toContain('blocked_id');
    }
  });
});

describe('enforcement', () => {
  const sql = flat(blocksMigration());

  it('answers "has this person blocked me" with a definer function', () => {
    // The check reads rows the caller is not allowed to read, so it cannot
    // run as the caller.
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_blocked_by(target UUID)');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
  });

  it('does not leave the function callable by anyone who asks', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.is_blocked_by(UUID) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.is_blocked_by(UUID) TO authenticated');
  });

  it('replaces the message insert policy rather than adding a second one', () => {
    // Permissive policies on the same command are OR'd together, so an extra
    // policy would permit everything the original did — the block would do
    // nothing at all.
    expect(sql).toContain('DROP POLICY "Users can send messages as themselves" ON public.messages');
    expect(sql).toContain('AND NOT public.is_blocked_by(receiver_id)');
  });

  it('replaces the comment insert policy the same way', () => {
    expect(sql).toContain('DROP POLICY "Users can comment as themselves" ON public.comments');
    expect(sql).toContain('public.is_blocked_by(p.user_id)');
  });

  it('leaves post visibility alone, deliberately', () => {
    // Hiding a blocker's posts changes feed semantics and interacts with the
    // is_private policy; it is a follow-up, and the client-side filter stays
    // until it is decided on its own terms.
    expect(sql).not.toContain('DROP POLICY "Posts visible unless author is private"');
  });
});
