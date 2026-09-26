//
// target: __tests__/features/hashtags/api.test.ts
// The hashtags domain's Supabase layer — features/hashtags/api.
//
// features/hashtags/api.ts imports nothing from React, which is what lets this
// suite call the real functions with only the Supabase client stubbed.

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

const mockLimit = jest.fn();
const mockOrder = jest.fn(() => ({ limit: mockLimit }));
const mockNot = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ not: mockNot }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { supabase } = require('../../../services/supabase.native');
supabase.from.mockReturnValue({ select: mockSelect });

import {
  fetchHashtags,
  countHashtags,
  HASHTAG_SCAN_LIMIT,
} from '../../../features/hashtags/api';

const rows = (...contents: (string | null)[]) => ({
  data: contents.map((content) => ({ content })),
  error: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  supabase.from.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ not: mockNot });
  mockNot.mockReturnValue({ order: mockOrder });
  mockOrder.mockReturnValue({ limit: mockLimit });
});

// ─── 1. Counting ────────────────────────────────────────────────────────

describe('countHashtags', () => {
  it('extracts #word tags and counts them', () => {
    expect(countHashtags(['#coffee is good', 'more #coffee and #tea'])).toEqual([
      { tag: 'coffee', postCount: 2 },
      { tag: 'tea', postCount: 1 },
    ]);
  });

  it('counts a tag once per post however often it appears', () => {
    // Otherwise one enthusiastic post outranks genuine interest from many.
    expect(countHashtags(['#coffee #coffee #coffee'])).toEqual([
      { tag: 'coffee', postCount: 1 },
    ]);
  });

  it('sorts by count, most used first', () => {
    const result = countHashtags(['#a', '#a #b', '#a #b #c']);
    expect(result.map((h) => h.tag)).toEqual(['a', 'b', 'c']);
    expect(result.map((h) => h.postCount)).toEqual([3, 2, 1]);
  });

  it('skips empty and missing content without throwing', () => {
    expect(countHashtags([null, undefined, '', '#a'])).toEqual([{ tag: 'a', postCount: 1 }]);
    expect(countHashtags([])).toEqual([]);
  });

  it('is case sensitive and ignores a bare hash', () => {
    expect(countHashtags(['#Coffee #coffee'])).toEqual([
      { tag: 'Coffee', postCount: 1 },
      { tag: 'coffee', postCount: 1 },
    ]);
    expect(countHashtags(['# not a tag'])).toEqual([]);
  });

  it('does not leak regex state between calls', () => {
    // The pattern is module-level and global; without resetting lastIndex the
    // second call would start mid-string and miss the first tag.
    expect(countHashtags(['#a #b'])).toEqual(countHashtags(['#a #b']));
  });
});

// ─── 2. Fetching ────────────────────────────────────────────────────────

describe('fetchHashtags', () => {
  it('queries recent post content within the scan limit', async () => {
    mockLimit.mockResolvedValue(rows('#a'));
    await fetchHashtags();

    expect(supabase.from).toHaveBeenCalledWith('posts');
    expect(mockSelect).toHaveBeenCalledWith('content');
    expect(mockNot).toHaveBeenCalledWith('content', 'is', null);
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(HASHTAG_SCAN_LIMIT);
    expect(HASHTAG_SCAN_LIMIT).toBe(500);
  });

  it('aggregates the rows it gets back', async () => {
    mockLimit.mockResolvedValue(rows('#coffee', '#coffee #tea'));
    await expect(fetchHashtags()).resolves.toEqual([
      { tag: 'coffee', postCount: 2 },
      { tag: 'tea', postCount: 1 },
    ]);
  });

  it('returns an empty list on an error rather than throwing', async () => {
    // The Explore screen has always degraded to an empty list here; a throw
    // would newly break the whole screen.
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(fetchHashtags()).resolves.toEqual([]);
    error.mockRestore();
  });

  it('returns an empty list when there are no posts', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    await expect(fetchHashtags()).resolves.toEqual([]);

    mockLimit.mockResolvedValue({ data: null, error: null });
    await expect(fetchHashtags()).resolves.toEqual([]);
  });
});
