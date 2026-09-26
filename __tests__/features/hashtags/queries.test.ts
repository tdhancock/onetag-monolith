//
// target: __tests__/features/hashtags/queries.test.ts
// The hashtags read hook — features/hashtags/queries.
//
// The hook is called with useQuery stubbed and the options it builds are
// inspected. That is the whole of what this layer does: pick the key from the
// factory and hand over the api function. Pinning it here catches the two
// mistakes the pattern exists to prevent — a hand-written key literal, and a
// hook that reimplements the query instead of delegating.

const mockUseQuery = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQuery: (options: unknown) => mockUseQuery(options),
}));

import { useHashtagsQuery } from '../../../features/hashtags/queries';
import { fetchHashtags } from '../../../features/hashtags/api';
import { hashtagKeys } from '../../../features/hashtags/keys';

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

type QueryOptions = { queryKey: readonly unknown[]; queryFn: unknown };

const optionsFor = (): QueryOptions => {
  mockUseQuery.mockClear();
  useHashtagsQuery();
  return mockUseQuery.mock.calls[0]![0] as QueryOptions;
};

describe('useHashtagsQuery', () => {
  it('calls useQuery once', () => {
    mockUseQuery.mockClear();
    useHashtagsQuery();
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
  });

  it('takes its key from the factory, not a literal', () => {
    // A raw array here is the bug the keys.ts rule exists to prevent — it
    // would work until something tried to invalidate the domain broadly.
    expect(optionsFor().queryKey).toEqual(hashtagKeys.lists());
    expect(optionsFor().queryKey).toEqual(['hashtags', 'list']);
  });

  it('sits under the domain root, so invalidating hashtagKeys.all reaches it', () => {
    const key = optionsFor().queryKey;
    expect(key.slice(0, hashtagKeys.all.length)).toEqual([...hashtagKeys.all]);
  });

  it('delegates to the api function rather than reimplementing the query', () => {
    expect(optionsFor().queryFn).toBe(fetchHashtags);
  });

  it('adds no local overrides, so it inherits the client defaults', () => {
    // staleTime, gcTime and retry are set once on the QueryClient in ONE-10.
    // A per-hook override here would be a silent divergence from that policy.
    expect(Object.keys(optionsFor()).sort()).toEqual(['queryFn', 'queryKey']);
  });

  it('returns whatever useQuery returns', () => {
    const result = { data: [{ tag: 'coffee', postCount: 2 }], isLoading: false };
    mockUseQuery.mockReturnValueOnce(result);
    expect(useHashtagsQuery()).toBe(result);
  });
});
