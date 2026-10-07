//
// target: __tests__/supabase/delete-user-account.test.ts
//
// Deleting an account. The function removes the account's files (ONE-99), then
// deletes its auth user and nothing else, letting the database cascade remove
// every profile the account holds and everything they own (ONE-88). So this
// pins:
//
//   * the handler: the caller and only the caller, files first, and nothing
//     deleted when the files can't be removed;
//   * the file removal: every file under the account's folders, however deep
//     or many, and nobody else's;
//   * that those folders cover every path every uploader writes to;
//   * that every migration's foreign key to a profile or an account says what
//     happens on delete, since the cascade holds only while each one does.
//
// supabase/tests/account_deletion.test.sql deletes a two-profile account
// against a real database.

const mockUploads: { bucket: string; path: string }[] = [];

jest.mock('../../services/supabase.native', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'aaaaaaaa-0000-0000-0000-000000000001' } } }),
    },
    storage: {
      from: (bucket: string) => ({
        // Every upload is refused as a policy error, so each uploader walks
        // every bucket and path it would ever try.
        upload: async (path: string) => {
          mockUploads.push({ bucket, path });
          return { error: { message: 'new row violates row-level security policy' } };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/${bucket}/${path}` } }),
      }),
    },
  },
}));

jest.mock('../../services/localFile', () => ({
  readLocalFile: async () => ({ arrayBuffer: new ArrayBuffer(1), contentType: 'image/jpeg', ext: 'jpg' }),
}));

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  FOLDERS_BEFORE_ACCOUNT,
  LIST_PAGE_SIZE,
  MEDIA_BUCKETS,
  REMOVE_BATCH_SIZE,
  accountMediaPrefixes,
  corsHeaders,
  handleRequest,
  removeAccountMedia,
} from '../../supabase/functions/delete-user-account/handler';
import type { AccountDeletion, MediaStorage, StorageEntry } from '../../supabase/functions/delete-user-account/handler';
import { uploadMedia } from '../../services/mediaUpload';
import { uploadStoryMedia } from '../../services/storyUpload';
import { DESTINATION_MEDIA_FOLDERS, uploadDestinationImage } from '../../services/destinationMedia';
import { uploadAvatar } from '../../features/profiles/api';
import { asAuthUserId } from '../../types';

const ROOT = join(__dirname, '..', '..');
const FUNCTION_DIR = join(ROOT, 'supabase', 'functions', 'delete-user-account');

const CALLER = 'aaaaaaaa-0000-0000-0000-000000000001';
const SOMEONE_ELSE = 'bbbbbbbb-0000-0000-0000-000000000002';

const setup = (overrides: Partial<AccountDeletion> = {}) => {
  const logged: unknown[] = [];
  const order: string[] = [];
  const impl: AccountDeletion = {
    callerId: async (authorization) => (authorization === 'Bearer caller-token' ? CALLER : null),
    removeMedia: async () => null,
    deleteUser: async () => null,
    ...overrides,
  };
  const deps = {
    callerId: jest.fn(impl.callerId),
    removeMedia: jest.fn(async (id: string) => {
      order.push('removeMedia');
      return impl.removeMedia(id);
    }),
    deleteUser: jest.fn(async (id: string) => {
      order.push('deleteUser');
      return impl.deleteUser(id);
    }),
    log: (_message: string, error: unknown) => {
      logged.push(error);
    },
  };
  return { deps, logged, order };
};

const request = (method = 'POST', authorization: string | null = 'Bearer caller-token') =>
  new Request('https://abcdefgh.supabase.co/functions/v1/delete-user-account', {
    method,
    headers: authorization ? { Authorization: authorization } : {},
  });

describe('delete-user-account', () => {
  it("removes the caller's files, then deletes the caller's auth user, and only the caller's", async () => {
    const { deps, order } = setup();
    const response = await handleRequest(request(), deps);
    expect(deps.callerId).toHaveBeenCalledWith('Bearer caller-token');
    expect(deps.removeMedia).toHaveBeenCalledWith(CALLER);
    expect(deps.deleteUser).toHaveBeenCalledWith(CALLER);
    expect(order).toEqual(['removeMedia', 'deleteUser']);
    // What Settings reads: `data.success`.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Account permanently deleted' });
  });

  it("deletes nothing when the files can't be removed, so the person can try again", async () => {
    const { deps } = setup({ removeMedia: async () => 'Storage is unavailable' });
    const response = await handleRequest(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to delete media', details: 'Storage is unavailable' });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ['no token', null],
    ['a token that is not a signed-in user', 'Bearer someone-else'],
  ])('refuses %s, removing and deleting nothing', async (_label, authorization) => {
    const { deps } = setup();
    const response = await handleRequest(request('POST', authorization), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Not authenticated' });
    expect(deps.removeMedia).not.toHaveBeenCalled();
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
      const source = readFileSync(join(FUNCTION_DIR, file), 'utf8')
        .replace(/\/\/.*$/gm, '')
        // Storage is files, not tables.
        .replace(/\.storage\s*\.from\(/g, '');
      expect(source).not.toMatch(/\.from\(/);
      expect(source).not.toMatch(/\.rpc\(/);
    }
  });
});

// ─── Removing the account's files ───────────────────────────────────────

/** Buckets of object paths, listed a folder at a time the way Supabase Storage lists them. */
const fakeStorage = (buckets: Record<string, string[]>) => {
  const objects = new Map(Object.entries(buckets).map(([bucket, paths]) => [bucket, new Set(paths)]));
  const removedBatches: number[] = [];
  const storage: MediaStorage = {
    async list(bucket, folder, { limit, offset }) {
      const entries = new Map<string, StorageEntry>();
      for (const path of objects.get(bucket) ?? []) {
        if (!path.startsWith(`${folder}/`)) continue;
        const [name, ...rest] = path.slice(folder.length + 1).split('/');
        entries.set(name, { name, isFolder: rest.length > 0 });
      }
      return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit);
    },
    async remove(bucket, paths) {
      removedBatches.push(paths.length);
      for (const path of paths) objects.get(bucket)?.delete(path);
    },
  };
  const left = (bucket: string) => [...(objects.get(bucket) ?? [])].sort();
  return { storage, left, removedBatches };
};

/** The same shape of uploads for any account: every folder an uploader writes to. */
const uploadsOf = (id: string, posts: number) => ({
  'post-media': [
    ...Array.from({ length: posts }, (_, i) => `${id}/posts/${String(i).padStart(4, '0')}.jpg`),
    `${id}/stories/one.jpg`,
    `${id}/stories/2026/09/deep.mp4`,
    `${id}/loose.jpg`,
    `posts/${id}/fallback.jpg`,
    `public/${id}/fallback.jpg`,
    `stories/${id}/fallback.jpg`,
    `products/${id}/door.jpg`,
    `projects/${id}/kitchen.jpg`,
  ],
  avatars: [`avatars/${id}/1.jpg`, `stories/${id}/fallback.jpg`, `public/${id}/fallback.jpg`],
});

describe("removing an account's files", () => {
  it("removes every one, however deep or many, and nobody else's", async () => {
    // More posts than two pages hold, so listing has to page.
    const mine = uploadsOf(CALLER, LIST_PAGE_SIZE * 2 + 50);
    const theirs = uploadsOf(SOMEONE_ELSE, 3);
    const { storage, left, removedBatches } = fakeStorage({
      'post-media': [...mine['post-media'], ...theirs['post-media']],
      avatars: [...mine.avatars, ...theirs.avatars],
    });

    await expect(removeAccountMedia(storage, CALLER)).resolves.toBeNull();

    expect(left('post-media')).toEqual([...theirs['post-media']].sort());
    expect(left('avatars')).toEqual([...theirs.avatars].sort());
    expect(Math.max(...removedBatches)).toBeLessThanOrEqual(REMOVE_BATCH_SIZE);
  });

  it('can run again, when there is nothing left to remove', async () => {
    const { storage, removedBatches } = fakeStorage({ 'post-media': [], avatars: [] });
    await expect(removeAccountMedia(storage, CALLER)).resolves.toBeNull();
    expect(removedBatches).toEqual([]);
  });

  it('reports a listing or a removal that fails, rather than throwing', async () => {
    const { storage } = fakeStorage(uploadsOf(CALLER, 1));
    const failingList: MediaStorage = { ...storage, list: async () => Promise.reject(new Error('list failed')) };
    const failingRemove: MediaStorage = { ...storage, remove: async () => Promise.reject(new Error('remove failed')) };
    await expect(removeAccountMedia(failingList, CALLER)).resolves.toBe('list failed');
    await expect(removeAccountMedia(failingRemove, CALLER)).resolves.toBe('remove failed');
  });

  it.each(['', ' ', 'avatars', '../', `${CALLER}/posts`])(
    "refuses %p, which isn't an account id, before listing anything",
    async (id) => {
      const list = jest.fn();
      const result = await removeAccountMedia({ list, remove: jest.fn() }, id);
      expect(result).toMatch(/^Refusing/);
      expect(list).not.toHaveBeenCalled();
    },
  );
});

describe("the account's folders", () => {
  /** Whether a path in a bucket is under one of the account's folders. */
  const covered = (bucket: string, path: string) =>
    accountMediaPrefixes(CALLER).some((folder) => folder.bucket === bucket && path.startsWith(`${folder.prefix}/`));

  const attempted = async () => {
    mockUploads.length = 0;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await uploadMedia('file:///photo.jpg', CALLER).catch(() => undefined);
      await uploadStoryMedia(new Blob(['x'], { type: 'image/jpeg' }), CALLER).catch(() => undefined);
      for (const folder of DESTINATION_MEDIA_FOLDERS) {
        await uploadDestinationImage('file:///photo.jpg', asAuthUserId(CALLER), folder).catch(() => undefined);
      }
      await uploadAvatar('file:///avatar.jpg');
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
    return [...mockUploads];
  };

  it('are the buckets the migrations create', () => {
    const dir = join(ROOT, 'supabase', 'migrations');
    const created = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .flatMap((name) => {
        const sql = readFileSync(join(dir, name), 'utf8');
        const inserts = sql.match(/INSERT INTO storage\.buckets[\s\S]*?;/gi) ?? [];
        return inserts.flatMap((insert) => Array.from(insert.matchAll(/\(\s*'([^']+)'/g), (m) => m[1]));
      });
    expect([...new Set(created)].sort()).toEqual([...MEDIA_BUCKETS].sort());
  });

  it('cover every path every uploader writes, in every bucket that exists', async () => {
    const uploads = await attempted();
    // Every uploader was reached, including each Destination folder.
    expect(uploads.some((u) => u.bucket === 'avatars' && u.path.startsWith(`avatars/${CALLER}/`))).toBe(true);
    for (const folder of DESTINATION_MEDIA_FOLDERS) {
      expect(uploads.some((u) => u.path.startsWith(`${folder}/${CALLER}/`))).toBe(true);
    }
    const uncovered = uploads.filter((u) => MEDIA_BUCKETS.includes(u.bucket) && !covered(u.bucket, u.path));
    expect(uncovered).toEqual([]);
  });

  it('put nothing but the account id where another account would begin', () => {
    for (const folder of FOLDERS_BEFORE_ACCOUNT) expect(folder).toMatch(/^[a-z-]+$/);
    for (const { prefix } of accountMediaPrefixes(CALLER)) {
      expect(prefix === CALLER || prefix.endsWith(`/${CALLER}`)).toBe(true);
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
  // A log entry is its project owner's record, and outlives who did the work (ONE-141).
  'project_log_entries.performed_by_profile_id',
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
