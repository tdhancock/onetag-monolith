//
// target: __tests__/features/explore/api.test.ts
//
// The Explore grid's data layer (ONE-47): one RPC per page, a cursor strictly
// after the last row, and each item once across pages. The ordering and the
// exclusions are the database's — supabase/tests/explore.test.sql pins those.

const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  EXPLORE_PAGE_SIZE,
  fetchExplorePage,
  flattenExplorePages,
  mapExploreRow,
  nextExploreCursor,
  type ExploreItem,
  type ExploreItemRow,
} from '../../../features/explore';

const row = (kind: 'post' | 'product' | 'project', id: string, extra: Partial<ExploreItemRow> = {}): ExploreItemRow => ({
  kind,
  id,
  item_key: `${kind}:${id}`,
  owner_profile_id: 'p-1',
  owner_username: 'ana',
  title: 'Title',
  image_url: 'https://x/i.jpg',
  media_type: 'image',
  tag_count: 0,
  created_at: '2026-09-26T00:00:00Z',
  score: 100,
  ...extra,
});

beforeEach(() => mockRpc.mockReset());

describe('fetchExplorePage', () => {
  it('asks explore_items for the first page with no cursor', async () => {
    mockRpc.mockResolvedValue({ data: [row('post', '1')], error: null });
    const page = await fetchExplorePage(null);
    expect(mockRpc).toHaveBeenCalledWith('explore_items', { p_after_score: null, p_after_key: null, p_limit: EXPLORE_PAGE_SIZE, p_interest: null });
    expect(page[0].key).toBe('post:1');
  });

  it('passes the cursor on for the next page', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchExplorePage({ score: 42.5, key: 'product:pd' });
    expect(mockRpc).toHaveBeenCalledWith('explore_items', { p_after_score: 42.5, p_after_key: 'product:pd', p_limit: EXPLORE_PAGE_SIZE, p_interest: null });
  });

  it('narrows to an interest in the query itself (ONE-49)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchExplorePage(null, 'custom-homes');
    expect(mockRpc).toHaveBeenCalledWith('explore_items', expect.objectContaining({ p_interest: 'custom-homes' }));
  });

  it('throws what the database returned', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('nope') });
    await expect(fetchExplorePage(null)).rejects.toThrow('nope');
  });
});

describe('mapExploreRow', () => {
  it('reads a post without a picture as text', () => {
    expect(mapExploreRow(row('post', '1', { image_url: null, media_type: 'image' })).mediaType).toBe('text');
    expect(mapExploreRow(row('post', '1', { media_type: 'text' })).mediaType).toBe('text');
  });

  it('keeps a product or project without a picture as a named cell', () => {
    const item = mapExploreRow(row('product', 'pd', { image_url: null, title: 'Lamp' }));
    expect(item).toMatchObject({ mediaType: 'image', imageUrl: null, title: 'Lamp' });
  });

  it('numbers the tag count and the score', () => {
    expect(mapExploreRow(row('post', '1', { tag_count: 3, score: '12.5' as unknown as number }))).toMatchObject({ tagCount: 3, score: 12.5 });
  });
});

describe('paging', () => {
  const item = (key: string, score = 1) => ({ key, score }) as ExploreItem;

  it('continues from the last row of a full page', () => {
    const page = Array.from({ length: EXPLORE_PAGE_SIZE }, (_, i) => item(`post:${i}`, 100 - i));
    expect(nextExploreCursor(page)).toEqual({ score: 100 - (EXPLORE_PAGE_SIZE - 1), key: `post:${EXPLORE_PAGE_SIZE - 1}` });
  });

  it('stops after a short page', () => {
    expect(nextExploreCursor([item('post:1')])).toBeUndefined();
  });

  it('keeps each item once, first sighting first', () => {
    expect(flattenExplorePages([[item('a'), item('b')], [item('b'), item('c')]]).map(i => i.key)).toEqual(['a', 'b', 'c']);
  });
});
