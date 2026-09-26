//
// target: __tests__/features/saves/saves.test.ts
//
// Saves beyond posts (ONE-39), without mounting anything:
//
//   1. The API reads and writes `saves` — never saved_posts — putting each
//      kind of target in its own column, and treats saving something already
//      saved as success.
//   2. getSavedPosts, moved here from features/posts, reads saves and scopes
//      the posts to the profile as viewer.
//   3. The toggle is the shared optimistic helper, configured over the
//      profile's save list: it flips at once, asks the server for whatever the
//      cache now says, and puts everything back when refused.
//   4. Keys are per profile, so a profile switch lists the other's saves.

const mockFrom = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { MutationObserver, QueryClient } from '@tanstack/react-query';
import {
  fetchSaves,
  getSavedPosts,
  mapSaveRow,
  saveKeyOf,
  saveKeys,
  saveTarget,
  saveToggleConfig,
  shouldSaveAfterFlip,
  targetOfSaveKey,
  toggleSave,
  unsaveTarget,
  type Save,
  type SaveRow,
} from '../../../features/saves';
import { toggleMutationOptions } from '../../../lib/optimisticToggle';

/** A query builder whose every method chains, and which awaits to `result`. */
function builder(result: unknown) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order', 'in', 'insert', 'delete', 'maybeSingle']) {
    chain[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

const ROW: SaveRow = {
  id: 's1',
  profile_id: 'p-ana',
  saved_post_id: null,
  saved_product_id: 'prod-1',
  saved_project_id: null,
  saved_profile_id: null,
  saved_at: '2026-09-26T10:00:00Z',
};

beforeEach(() => mockFrom.mockReset());

// ─── 1. The API ─────────────────────────────────────────────────────────

describe('mapping a row', () => {
  it.each([
    ['post', 'saved_post_id'],
    ['product', 'saved_product_id'],
    ['project', 'saved_project_id'],
    ['profile', 'saved_profile_id'],
  ] as const)('reads a %s from %s', (kind, column) => {
    const row = { ...ROW, saved_product_id: null, [column]: 'x-1' };
    expect(mapSaveRow(row)).toEqual({ id: 's1', profileId: 'p-ana', target: { kind, id: 'x-1' }, savedAt: ROW.saved_at });
  });

  it('skips a row with no target', () => {
    expect(mapSaveRow({ ...ROW, saved_product_id: null })).toBeNull();
  });

  it('keys a target as kind:id, and back', () => {
    expect(saveKeyOf({ kind: 'project', id: 'pj-1' })).toBe('project:pj-1');
    expect(targetOfSaveKey('project:pj-1')).toEqual({ kind: 'project', id: 'pj-1' });
    expect(targetOfSaveKey('vendor:1')).toBeNull();
    expect(targetOfSaveKey('post:')).toBeNull();
  });
});

describe('reading and writing saves', () => {
  it("lists a profile's saves, newest first, from saves", async () => {
    const read = builder({ data: [ROW], error: null });
    mockFrom.mockReturnValue(read.chain);
    const saves = await fetchSaves('p-ana');
    expect(mockFrom).toHaveBeenCalledWith('saves');
    expect(read.calls.eq).toEqual([['profile_id', 'p-ana']]);
    expect(read.calls.order).toEqual([['saved_at', { ascending: false }]]);
    expect(saves.map((s) => s.target)).toEqual([{ kind: 'product', id: 'prod-1' }]);
  });

  it.each([
    ['post', 'saved_post_id'],
    ['product', 'saved_product_id'],
    ['project', 'saved_project_id'],
    ['profile', 'saved_profile_id'],
  ] as const)('saves a %s in %s', async (kind, column) => {
    const write = builder({ error: null });
    mockFrom.mockReturnValue(write.chain);
    await saveTarget('p-ana', { kind, id: 't-1' });
    expect(mockFrom).toHaveBeenCalledWith('saves');
    expect(write.calls.insert).toEqual([[{ profile_id: 'p-ana', [column]: 't-1' }]]);
  });

  it('treats saving something already saved as success', async () => {
    mockFrom.mockReturnValue(builder({ error: { code: '23505', message: 'duplicate' } }).chain);
    await expect(saveTarget('p-ana', { kind: 'post', id: 'po-1' })).resolves.toBeUndefined();
  });

  it('throws any other refusal, so the toggle rolls back', async () => {
    mockFrom.mockReturnValue(builder({ error: { code: '42501', message: 'row-level security' } }).chain);
    await expect(saveTarget('p-ana', { kind: 'post', id: 'po-1' })).rejects.toMatchObject({ code: '42501' });
  });

  it("unsaves by the profile and the target's column", async () => {
    const del = builder({ error: null });
    mockFrom.mockReturnValue(del.chain);
    await unsaveTarget('p-ana', { kind: 'profile', id: 'p-bo' });
    expect(del.calls.delete).toHaveLength(1);
    expect(del.calls.eq).toEqual([['profile_id', 'p-ana'], ['saved_profile_id', 'p-bo']]);
  });

  it('flips a save: removes one that is there, and says so', async () => {
    const read = builder({ data: { id: 's1' }, error: null });
    const del = builder({ error: null });
    mockFrom.mockReturnValueOnce(read.chain).mockReturnValueOnce(del.chain);
    await expect(toggleSave('p-ana', { kind: 'post', id: 'po-1' })).resolves.toBe(false);
    expect(read.calls.eq).toEqual([['profile_id', 'p-ana'], ['saved_post_id', 'po-1']]);
    expect(del.calls.delete).toHaveLength(1);
  });

  it('and adds one that is not', async () => {
    const read = builder({ data: null, error: null });
    const insert = builder({ error: null });
    mockFrom.mockReturnValueOnce(read.chain).mockReturnValueOnce(insert.chain);
    await expect(toggleSave('p-ana', { kind: 'post', id: 'po-1' })).resolves.toBe(true);
    expect(insert.calls.insert).toEqual([[{ profile_id: 'p-ana', saved_post_id: 'po-1' }]]);
  });

  it('never touches saved_posts', async () => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }).chain);
    await fetchSaves('p-ana');
    await getSavedPosts('p-ana');
    expect(mockFrom.mock.calls.map(([table]) => table)).not.toContain('saved_posts');
  });
});

// ─── 2. Saved posts ─────────────────────────────────────────────────────

describe('getSavedPosts', () => {
  it('reads saved posts from saves, scopes them to the profile, and orders them by when they were saved', async () => {
    const saved = builder({
      data: [
        { saved_post_id: 'po-new', saved_at: '2026-09-26T10:00:00Z' },
        { saved_post_id: 'po-old', saved_at: '2026-09-20T10:00:00Z' },
      ],
      error: null,
    });
    const posts = builder({
      data: [
        { id: 'po-old', content: 'old', created_at: '2026-01-01', profiles: { username: 'a' } },
        { id: 'po-new', content: 'new', created_at: '2025-01-01', profiles: { username: 'b' } },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(saved.chain).mockReturnValueOnce(posts.chain);

    const result = await getSavedPosts('p-ana');

    expect(mockFrom.mock.calls.map(([t]) => t)).toEqual(['saves', 'posts']);
    expect(saved.calls.eq).toEqual([['profile_id', 'p-ana']]);
    expect(saved.calls.not).toEqual([['saved_post_id', 'is', null]]);
    expect(posts.calls.in).toEqual([['id', ['po-new', 'po-old']]]);
    expect(posts.calls.eq).toEqual([
      ['viewer_like.user_id', 'p-ana'],
      ['viewer_repost.user_id', 'p-ana'],
      ['viewer_save.profile_id', 'p-ana'],
    ]);
    expect(result.map((p) => p.id)).toEqual(['po-new', 'po-old']);
  });

  it('is empty, not an error, when nothing is saved', async () => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }).chain);
    await expect(getSavedPosts('p-ana')).resolves.toEqual([]);
  });
});

// ─── 3. The toggle ──────────────────────────────────────────────────────

const PROFILE = 'p-ana';
const LIST_KEY = saveKeys.mine(PROFILE);

const save = (kind: Save['target']['kind'], id: string): Save => ({
  id: `s-${id}`,
  profileId: PROFILE,
  target: { kind, id },
  savedAt: '2026-09-25T00:00:00Z',
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Run the real configuration through the helper's real cycle. */
const runToggle = async (client: QueryClient, key: string) => {
  const observer = new MutationObserver<unknown, Error, string>(
    client,
    toggleMutationOptions(client, saveToggleConfig(client, PROFILE)) as never,
  );
  await observer.mutate(key).catch(() => undefined);
};

/** A write the test decides the outcome of. */
function heldWrite(error: unknown = null) {
  let release: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    mockFrom.mockImplementation(() => {
      const write = builder(new Promise((done) => (release = () => done({ error }))));
      resolve();
      return write.chain;
    });
  });
  return { reached, release: () => release() };
}

describe('the save toggle', () => {
  it('adds the target to the list before the server answers, then saves it', async () => {
    const client = newClient();
    client.setQueryData(LIST_KEY, [save('post', 'po-1')]);
    const write = heldWrite();

    const done = runToggle(client, 'product:prod-1');
    await write.reached;
    expect(client.getQueryData<Save[]>(LIST_KEY)!.map((s) => saveKeyOf(s.target))).toEqual([
      'product:prod-1',
      'post:po-1',
    ]);
    write.release();
    await done;
    expect(mockFrom).toHaveBeenCalledWith('saves');
  });

  it('removes a saved target, and asks the server to unsave it', async () => {
    const client = newClient();
    client.setQueryData(LIST_KEY, [save('project', 'pj-1')]);
    const calls: string[] = [];
    mockFrom.mockImplementation(() => {
      const write = builder({ error: null });
      const chain = write.chain as { insert: unknown; delete: unknown };
      const insert = chain.insert as (...a: unknown[]) => unknown;
      const del = chain.delete as (...a: unknown[]) => unknown;
      chain.insert = (...a: unknown[]) => (calls.push('insert'), insert(...a));
      chain.delete = (...a: unknown[]) => (calls.push('delete'), del(...a));
      return write.chain;
    });

    await runToggle(client, 'project:pj-1');
    expect(calls).toEqual(['delete']);
  });

  it('puts the list back exactly when the save is refused', async () => {
    const client = newClient();
    const before = [save('post', 'po-1')];
    client.setQueryData(LIST_KEY, before);
    // Refused, and the refetch the settle triggers fails too, so what remains is the rollback.
    mockFrom.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'refused' } }).chain);

    await runToggle(client, 'profile:p-bo');
    expect(client.getQueryData<Save[]>(LIST_KEY)).toEqual(before);
  });

  it('saves, rather than silently unsaving, when the list has not loaded', () => {
    expect(shouldSaveAfterFlip(undefined, 'post:po-1')).toBe(true);
    expect(shouldSaveAfterFlip([save('post', 'po-1')], 'post:po-1')).toBe(true);
    expect(shouldSaveAfterFlip([], 'post:po-1')).toBe(false);
  });

  it('is the shared helper, with no rollback of its own', () => {
    const config = saveToggleConfig(newClient(), PROFILE);
    expect(Object.keys(config).sort()).toEqual(
      ['apply', 'count', 'entityId', 'entityKey', 'isOn', 'listKey', 'mutationFn'].sort(),
    );
    expect(config).not.toHaveProperty('onError');
  });
});

// ─── 4. Per profile ─────────────────────────────────────────────────────

describe('keys', () => {
  it('give each profile its own list, so a switch reads the newly active profile\'s saves', () => {
    expect(saveKeys.mine('p-ana')).toEqual(['saves', 'list', { profileId: 'p-ana' }]);
    expect(saveKeys.mine('p-ana')).not.toEqual(saveKeys.mine('p-studio'));
  });
});
