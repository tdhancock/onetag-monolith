//
// target: __tests__/features/tags/owner.test.ts
//
// The owner's side of the tags domain (ONE-32, ONE-34), without mounting:
//
//   1. fetchMyTags lists one profile's tags newest first and takes each
//      one's scan count from tag_scan_counts, merged by tag id — it never
//      reads scan rows, which an owner cannot see.
//   2. createTag sends no short code — the database issues it — sets `format`
//      by type, and reads the row back.
//   3. updateTag sends the name and note only; the short code and the
//      destination are never written. A row RLS filtered out is an error,
//      not a silent success, for update, activation and delete alike.

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  activeAfterFlip,
  createTag,
  deleteTag,
  fetchMyTags,
  mapTagRow,
  setTagActive,
  TAG_SELECT,
  tagKeys,
  updateTag,
  type OwnedTag,
  type TagRow,
} from '../../../features/tags';
import { asProfileId } from '../../../types';

const ROW: TagRow = {
  id: 't1',
  owner_profile_id: 'p-studio',
  tag_type: 'physical',
  format: 'qr',
  name: 'Front door',
  note: 'By the bell',
  short_code: 'ABC23XYZ',
  active: true,
  created_at: '2026-09-24T10:00:00Z',
  dest_profile_id: 'p-studio',
  dest_profile: { id: 'p-studio', username: 'ana_studio', full_name: 'Ana Studio', profile_type: 'business' },
};

/** A query builder whose every method chains, and which awaits to `result`. */
function builder(result: unknown) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single']) {
    chain[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

// ─── 1. Listing ─────────────────────────────────────────────────────────

describe('fetchMyTags', () => {
  it("lists the profile's tags newest first, with counts from tag_scan_counts merged by tag id", async () => {
    const second: TagRow = { ...ROW, id: 't2', short_code: 'DEF45GHJ', created_at: '2026-09-20T10:00:00Z' };
    const tags = builder({ data: [ROW, second], error: null });
    mockFrom.mockReturnValue(tags.chain);
    mockRpc.mockResolvedValue({
      data: [
        { tag_id: 't2', scan_count: 3, last_scanned_at: '2026-09-23T08:00:00Z' },
        { tag_id: 't1', scan_count: 0, last_scanned_at: null },
      ],
      error: null,
    });

    const result = await fetchMyTags(asProfileId('p-studio'));

    expect(mockFrom).toHaveBeenCalledWith('tags');
    expect(tags.calls.select).toEqual([[TAG_SELECT]]);
    expect(tags.calls.eq).toEqual([['owner_profile_id', 'p-studio']]);
    expect(tags.calls.order).toEqual([['created_at', { ascending: false }]]);
    expect(mockRpc).toHaveBeenCalledWith('tag_scan_counts', { p_owner_profile_id: 'p-studio' });

    expect(result.map((t) => [t.id, t.scanCount, t.lastScannedAt])).toEqual([
      ['t1', 0, null],
      ['t2', 3, '2026-09-23T08:00:00Z'],
    ]);
  });

  it('never reads scan rows', async () => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }).chain);
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchMyTags(asProfileId('p-studio'));
    expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['tags']);
    expect(TAG_SELECT).not.toMatch(/scans/);
  });

  it('fails when either read fails, rather than showing zero scans', async () => {
    mockFrom.mockReturnValue(builder({ data: [ROW], error: null }).chain);
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(fetchMyTags(asProfileId('p-studio'))).rejects.toThrow('boom');
  });

  it('maps a row and its embedded destination profile', () => {
    expect(mapTagRow(ROW)).toEqual<OwnedTag>({
      id: 't1',
      ownerProfileId: 'p-studio',
      tagType: 'physical',
      format: 'qr',
      name: 'Front door',
      note: 'By the bell',
      shortCode: 'ABC23XYZ',
      active: true,
      createdAt: '2026-09-24T10:00:00Z',
      destination: { kind: 'profile', profileId: 'p-studio', username: 'ana_studio', name: 'Ana Studio', profileType: 'business' },
      scanCount: 0,
      lastScannedAt: null,
    });
    // A one-element array embed reads the same; a missing one is no destination.
    expect(mapTagRow({ ...ROW, dest_profile: [ROW.dest_profile as never] }).destination?.username).toBe('ana_studio');
    expect(mapTagRow({ ...ROW, dest_profile: null }).destination).toBeNull();
  });

  it('keys each profile its own list', () => {
    expect(tagKeys.mine('p-a')).toEqual(['tags', 'list', { ownerProfileId: 'p-a' }]);
    expect(tagKeys.mine('p-a')).not.toEqual(tagKeys.mine('p-b'));
  });
});

// ─── 2. Creating ────────────────────────────────────────────────────────

describe('createTag', () => {
  it('inserts a Physical Tag with format qr and no short code, and reads the database-issued code back', async () => {
    const insert = builder({ data: ROW, error: null });
    mockFrom.mockReturnValue(insert.chain);

    const created = await createTag({
      ownerProfileId: asProfileId('p-studio'),
      tagType: 'physical',
      destinationProfileId: 'p-studio',
      name: 'Front door',
      note: null,
    });

    expect(insert.calls.insert).toEqual([
      [
        {
          owner_profile_id: 'p-studio',
          tag_type: 'physical',
          format: 'qr',
          name: 'Front door',
          note: null,
          dest_profile_id: 'p-studio',
        },
      ],
    ]);
    expect(insert.calls.select).toEqual([[TAG_SELECT]]);
    expect(insert.calls.single).toHaveLength(1);
    expect(created.shortCode).toBe('ABC23XYZ');
  });

  it('inserts a Digital Tag with no format', async () => {
    const insert = builder({ data: { ...ROW, tag_type: 'digital', format: null }, error: null });
    mockFrom.mockReturnValue(insert.chain);
    await createTag({
      ownerProfileId: asProfileId('p-studio'),
      tagType: 'digital',
      destinationProfileId: 'p-ana',
      name: null,
      note: null,
    });
    expect(insert.calls.insert![0]![0]).toMatchObject({ tag_type: 'digital', format: null, dest_profile_id: 'p-ana' });
  });

  it('throws what the database refused', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: new Error('new row violates row-level security') }).chain);
    await expect(
      createTag({ ownerProfileId: asProfileId('p'), tagType: 'digital', destinationProfileId: 'x', name: null, note: null }),
    ).rejects.toThrow('row-level security');
  });
});

// ─── 3. Changing ────────────────────────────────────────────────────────

describe('updateTag, setTagActive and deleteTag', () => {
  it('updates the name and note only', async () => {
    const update = builder({ data: [{ id: 't1' }], error: null });
    mockFrom.mockReturnValue(update.chain);
    await updateTag('t1', { name: 'Back door', note: null });
    expect(update.calls.update).toEqual([[{ name: 'Back door', note: null }]]);
    expect(update.calls.eq).toEqual([['id', 't1']]);
  });

  it('never writes the short code or the destination, whatever it is handed', async () => {
    const update = builder({ data: [{ id: 't1' }], error: null });
    mockFrom.mockReturnValue(update.chain);
    await updateTag('t1', { name: 'x', short_code: 'ZZZZZZZZ', dest_profile_id: 'p-other' } as never);
    expect(update.calls.update).toEqual([[{ name: 'x' }]]);
  });

  it('sets active', async () => {
    const update = builder({ data: [{ id: 't1' }], error: null });
    mockFrom.mockReturnValue(update.chain);
    await setTagActive('t1', false);
    expect(update.calls.update).toEqual([[{ active: false }]]);
  });

  it('deletes by id', async () => {
    const del = builder({ data: [{ id: 't1' }], error: null });
    mockFrom.mockReturnValue(del.chain);
    await deleteTag('t1');
    expect(del.calls.delete).toHaveLength(1);
    expect(del.calls.eq).toEqual([['id', 't1']]);
  });

  it.each([
    ['updateTag', () => updateTag('t1', { name: 'x' })],
    ['setTagActive', () => setTagActive('t1', true)],
    ['deleteTag', () => deleteTag('t1')],
  ])('%s fails when RLS filtered the row out, rather than reporting success', async (_name, call) => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }).chain);
    await expect(call()).rejects.toThrow('Tag not found.');
  });
});

describe('activeAfterFlip', () => {
  it('reads the flipped state off the cached list, and nothing when the tag is not in it', () => {
    const list = [mapTagRow({ ...ROW, active: false })];
    expect(activeAfterFlip(list, 't1')).toBe(false);
    expect(activeAfterFlip(list, 'other')).toBeUndefined();
    expect(activeAfterFlip(undefined, 't1')).toBeUndefined();
  });
});
