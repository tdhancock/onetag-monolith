//
// target: __tests__/supabase/delete-user-account.test.ts
//
// Deleting an account (ONE-88). The function deletes the caller's auth user and
// nothing else; the database cascade removes every profile the account holds
// and everything they own. So this pins two things: the handler deletes the
// caller and only the caller, and every migration's foreign key to a profile
// or an account says what happens on delete, since the cascade holds only
// while each one does. supabase/tests/account_deletion.test.sql deletes a
// two-profile account against a real database.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { corsHeaders, handleRequest } from '../../supabase/functions/delete-user-account/handler';
import type { AccountDeletion } from '../../supabase/functions/delete-user-account/handler';

const ROOT = join(__dirname, '..', '..');
const FUNCTION_DIR = join(ROOT, 'supabase', 'functions', 'delete-user-account');

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001';

const setup = (overrides: Partial<AccountDeletion> = {}) => {
  const logged: unknown[] = [];
  const impl: AccountDeletion = {
    callerId: async (authorization) => (authorization === 'Bearer caller-token' ? CALLER : null),
    deleteUser: async () => null,
    ...overrides,
  };
  const deps = {
    callerId: jest.fn(impl.callerId),
    deleteUser: jest.fn(impl.deleteUser),
    log: (_message: string, error: unknown) => {
      logged.push(error);
    },
  };
  return { deps, logged };
};

const request = (method = 'POST', authorization: string | null = 'Bearer caller-token') =>
  new Request('https://abcdefgh.supabase.co/functions/v1/delete-user-account', {
    method,
    headers: authorization ? { Authorization: authorization } : {},
  });

describe('delete-user-account', () => {
  it("deletes the caller's auth user, and only the caller's", async () => {
    const { deps } = setup();
    const response = await handleRequest(request(), deps);
    expect(deps.callerId).toHaveBeenCalledWith('Bearer caller-token');
    expect(deps.deleteUser).toHaveBeenCalledTimes(1);
    expect(deps.deleteUser).toHaveBeenCalledWith(CALLER);
    // What Settings reads: `data.success`.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Account permanently deleted' });
  });

  it.each([
    ['no token', null],
    ['a token that is not a signed-in user', 'Bearer someone-else'],
  ])('refuses %s, deleting nothing', async (_label, authorization) => {
    const { deps } = setup();
    const response = await handleRequest(request('POST', authorization), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Not authenticated' });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('reports a failed delete, which the cascade makes all or nothing', async () => {
    const { deps } = setup({ deleteUser: async () => 'Database error deleting user' });
    const response = await handleRequest(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to delete auth user',
      details: 'Database error deleting user',
    });
  });

  it('turns anything unexpected into a 500, and logs it', async () => {
    const failure = new Error('network');
    const { deps, logged } = setup({ callerId: async () => Promise.reject(failure) });
    const response = await handleRequest(request(), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Internal server error');
    expect(logged).toEqual([failure]);
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('answers the CORS preflight without touching the account', async () => {
    const { deps } = setup();
    const response = await handleRequest(request('OPTIONS'), deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(corsHeaders['Access-Control-Allow-Origin']);
    expect(deps.callerId).not.toHaveBeenCalled();
  });

  it('touches no table itself: the cascade does the deleting', () => {
    for (const file of ['index.ts', 'handler.ts']) {
      const source = readFileSync(join(FUNCTION_DIR, file), 'utf8').replace(/\/\/.*$/gm, '');
      expect(source).not.toMatch(/\.from\(/);
      expect(source).not.toMatch(/\.rpc\(/);
    }
  });
});

// ─── The cascade the function relies on ─────────────────────────────────

interface ForeignKey {
  /** `table.column`. */
  column: string;
  /** CASCADE, SET NULL, or null when the migration says nothing, which is NO ACTION. */
  onDelete: string | null;
  file: string;
}

/**
 * Every foreign key the migrations declare to a profile or to an account,
 * inline on a column or as a table constraint, as each column last declares
 * it: a later migration re-creating a key (ONE-98 re-created reports.reviewed_by)
 * replaces the earlier declaration. A key dropped and never re-declared still
 * counts, as it was last declared.
 */
const foreignKeysToPeople = (): ForeignKey[] => {
  const dir = join(ROOT, 'supabase', 'migrations');
  const keys = new Map<string, ForeignKey>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
    for (const statement of sql.split(';')) {
      const table = /(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: ONLY)?)\s+(?:public\.)?(\w+)/i.exec(statement)?.[1];
      if (!table) continue;
      const references =
        /(?:(\w+)\s+UUID\b[^,;()]*?|FOREIGN KEY\s*\(\s*(\w+)\s*\)\s*)REFERENCES\s+(?:public\.profiles|auth\.users)\s*\(\s*id\s*\)([^,;]*)/gi;
      for (const match of statement.matchAll(references)) {
        const column = `${table}.${match[1] ?? match[2]}`;
        const onDelete = /ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT|SET DEFAULT)/i.exec(match[3])?.[1].toUpperCase() ?? null;
        keys.set(column, { column, onDelete, file });
      }
    }
  }
  return [...keys.values()];
};

/** Kept, not deleted, when their profile goes: the row belongs to someone else. */
const SET_NULL_ON_PURPOSE = [
  // A scan stays in the tag owner's counts, with no scanner.
  'scans.scanner_profile_id',
  // A message between two other people keeps its text when the profile it shared goes.
  'messages.shared_profile_id',
  // A report keeps its history when the admin who reviewed it goes (ONE-98).
  'reports.reviewed_by',
];

describe('every foreign key to a profile or an account', () => {
  const keys = foreignKeysToPeople();

  it('is found, including the one the whole cascade hangs on', () => {
    expect(keys.length).toBeGreaterThan(25);
    expect(keys).toContainEqual(expect.objectContaining({ column: 'profiles.user_id', onDelete: 'CASCADE' }));
  });

  it('cascades, or sets null on purpose: anything else stops an account being deleted', () => {
    const unaccounted = keys.filter(
      (key) => key.onDelete !== 'CASCADE' && !(key.onDelete === 'SET NULL' && SET_NULL_ON_PURPOSE.includes(key.column)),
    );
    expect(unaccounted).toEqual([]);
  });

  it('sets null only where that is the point', () => {
    const setNull = keys.filter((key) => key.onDelete === 'SET NULL').map((key) => key.column);
    expect(setNull.sort()).toEqual([...SET_NULL_ON_PURPOSE].sort());
  });
});
