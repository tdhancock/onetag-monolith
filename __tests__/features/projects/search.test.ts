//
// target: __tests__/features/projects/search.test.ts
//
// The composer's tag picker searches public projects from every account
// (ONE-46) — never a private one, which ONE-44's insert policy would refuse.

const mockCalls: { method: string; args: unknown[] }[] = [];
let mockRows: unknown[] = [];

jest.mock('../../../services/supabase.native', () => {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'ilike', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      mockCalls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: mockRows, error: null }).then(resolve);
  return { supabase: chain };
});

import { searchPublicProjects, PROJECT_SEARCH_LIMIT } from '../../../features/projects';

const called = (method: string) => mockCalls.filter((c) => c.method === method).map((c) => c.args);

beforeEach(() => {
  mockCalls.length = 0;
  mockRows = [];
});

describe('searchPublicProjects', () => {
  it('asks only for public projects, by name, newest first, capped', async () => {
    await searchPublicProjects('loft');
    expect(called('from')).toEqual([['projects']]);
    expect(called('eq')).toEqual([['is_public', true]]);
    expect(called('ilike')).toEqual([['name', '%loft%']]);
    expect(called('order')).toEqual([['created_at', { ascending: false }]]);
    expect(called('limit')).toEqual([[PROJECT_SEARCH_LIMIT]]);
  });

  it('takes PostgREST wildcards out of what was typed, and lists the newest for an empty search', async () => {
    await searchPublicProjects(' %*  ');
    expect(called('ilike')).toEqual([]);
    expect(called('eq')).toEqual([['is_public', true]]);
  });

  it('maps rows onto project summaries', async () => {
    mockRows = [
      { id: 'pj-1', owner_profile_id: 'p-1', name: 'Loft', project_type: null, year: '2026', cover_url: 'c.jpg', is_public: true, created_at: '2026-09-26T00:00:00Z' },
    ];
    expect(await searchPublicProjects('loft')).toEqual([
      { id: 'pj-1', ownerProfileId: 'p-1', name: 'Loft', projectType: null, year: '2026', coverUrl: 'c.jpg', isPublic: true, createdAt: '2026-09-26T00:00:00Z' },
    ]);
  });
});
