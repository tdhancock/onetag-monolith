//
// target: __tests__/features/stories/stories.api.test.ts
//
// Stories expire 24 hours after they are posted (ONE-19). The age filter is
// applied by the fetch itself, so a refetch is what takes an expired story
// out of the reel and out of "Your story" — pinned here against the query the
// client actually builds.

const mockCalls: { method: string; args: unknown[] }[] = [];

/** A PostgREST builder stub: records each call and resolves to no rows. */
const builder = (): Record<string, unknown> => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'eq', 'gte', 'order']) {
    chain[method] = (...args: unknown[]) => {
      mockCalls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
  return chain;
};

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
    from: () => builder(),
  },
}));

jest.mock('../../../services/profileBootstrap', () => ({ ensureProfileRowForUser: jest.fn() }));
jest.mock('../../../services/storyUpload', () => ({}));
jest.mock('../../../services/mediaUpload', () => ({}));

import { getMyStories, getStories, isLive, liveCutoff, STORY_LIFETIME_MS } from '../../../features/stories/api';
import { asProfileId } from '../../../types';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');

beforeEach(() => {
  mockCalls.length = 0;
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

const cutoffs = () =>
  mockCalls.filter((call) => call.method === 'gte' && call.args[0] === 'created_at').map((call) => call.args[1]);

describe('24-hour expiry', () => {
  it('the reel only asks for stories newer than 24 hours', async () => {
    await getStories(asProfileId('me'));
    expect(cutoffs()).toEqual([new Date(NOW - STORY_LIFETIME_MS).toISOString()]);
  });

  it('"Your story" only asks for stories newer than 24 hours', async () => {
    await getMyStories('me');
    expect(cutoffs()).toEqual([liveCutoff(NOW)]);
  });

  it('a story older than 24 hours is not live', () => {
    expect(isLive({ timestamp: new Date(NOW - STORY_LIFETIME_MS - 1).toISOString() }, NOW)).toBe(false);
    expect(isLive({ timestamp: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(true);
  });
});
