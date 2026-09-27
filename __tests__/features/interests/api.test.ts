//
// target: __tests__/features/interests/api.test.ts
//
// The interest list (ONE-49): read in the order the migration seeded it.
// Who may write it is the database's — supabase/tests/interests.test.sql.

const mockCalls: { method: string; args: unknown[] }[] = [];
let mockResult: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('../../../services/supabase.native', () => {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'order']) {
    chain[method] = (...args: unknown[]) => {
      mockCalls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(mockResult).then(resolve);
  return { supabase: chain };
});

import { fetchInterests } from '../../../features/interests';
import { EMPTY_PROJECT_DRAFT, projectFieldsFrom } from '../../../lib/screens/projects';

beforeEach(() => {
  mockCalls.length = 0;
  mockResult = { data: [], error: null };
});

it('reads slug and name, in the seeded order', async () => {
  mockResult = { data: [{ slug: 'custom-homes', name: 'Custom Homes' }], error: null };
  expect(await fetchInterests()).toEqual([{ slug: 'custom-homes', name: 'Custom Homes' }]);
  expect(mockCalls).toEqual([
    { method: 'from', args: ['interests'] },
    { method: 'select', args: ['slug, name'] },
    { method: 'order', args: ['sort_order', { ascending: true }] },
  ]);
});

it('throws what the database returned', async () => {
  mockResult = { data: null, error: new Error('down') };
  await expect(fetchInterests()).rejects.toThrow('down');
});

it('saves a project with no interest by default, and the one chosen otherwise', () => {
  expect(projectFieldsFrom({ ...EMPTY_PROJECT_DRAFT, name: 'Shed' }).interestSlug).toBeNull();
  expect(projectFieldsFrom({ ...EMPTY_PROJECT_DRAFT, name: 'Shed', interestSlug: 'diy-projects' }).interestSlug).toBe('diy-projects');
});
