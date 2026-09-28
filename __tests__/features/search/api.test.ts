//
// target: __tests__/features/search/api.test.ts
//
// Search's data layer (ONE-48): one database function per content type, and
// rows mapped onto what the results render. Ranking, blocking and privacy
// are the database's — supabase/tests/search.test.sql pins those.

const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { SEARCH_RESULT_LIMIT, searchPosts, searchProducts, searchProfiles, searchProjects } from '../../../features/search';

beforeEach(() => mockRpc.mockReset());

it('searches each type through its own function, with the category where there is one', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await searchProfiles('ana');
  await searchPosts('kitchen');
  await searchProducts('oak', 'Seating');
  await searchProjects('loft');
  expect(mockRpc.mock.calls).toEqual([
    ['search_profiles', { p_query: 'ana', p_limit: SEARCH_RESULT_LIMIT }],
    ['search_posts', { p_query: 'kitchen', p_limit: SEARCH_RESULT_LIMIT }],
    ['search_products', { p_query: 'oak', p_category: 'Seating', p_limit: SEARCH_RESULT_LIMIT }],
    ['search_projects', { p_query: 'loft', p_category: null, p_limit: SEARCH_RESULT_LIMIT, p_public_only: false }],
  ]);
});

it('asks for public projects only when the tag picker does (ONE-93)', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await searchProjects('loft', null, true);
  expect(mockRpc).toHaveBeenCalledWith('search_projects', expect.objectContaining({ p_public_only: true }));
});

it('maps each row onto its result shape', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: [{ id: 'p', username: 'ana', full_name: null, avatar_url: null, is_verified: true, profile_type: 'business', is_private: true }], error: null })
    .mockResolvedValueOnce({ data: [{ id: 'po', content: 'hi', image_url: null, media_type: 'image', author_username: 'ana', author_avatar_url: 'a.jpg' }], error: null })
    .mockResolvedValueOnce({ data: [{ id: 'pd', name: 'Lamp', category: null, image_url: 'l.jpg', business_username: 'oak', business_name: 'Oak Co' }], error: null })
    .mockResolvedValueOnce({ data: [{ id: 'pj', name: 'Loft', project_type: 'Interior', cover_url: null, owner_username: 'ana' }], error: null });

  expect(await searchProfiles('a')).toEqual([{ id: 'p', username: 'ana', name: 'ana', avatarUrl: null, isVerified: true, profileType: 'business', isPrivate: true }]);
  expect(await searchPosts('a')).toEqual([{ id: 'po', content: 'hi', imageUrl: null, mediaType: 'text', authorUsername: 'ana', authorAvatarUrl: 'a.jpg' }]);
  expect(await searchProducts('a')).toEqual([{ id: 'pd', name: 'Lamp', category: null, imageUrl: 'l.jpg', businessUsername: 'oak', businessName: 'Oak Co' }]);
  expect(await searchProjects('a')).toEqual([{ id: 'pj', name: 'Loft', category: 'Interior', coverUrl: null, ownerUsername: 'ana' }]);
});

it('throws what the database returned', async () => {
  mockRpc.mockResolvedValue({ data: null, error: new Error('down') });
  await expect(searchPosts('a')).rejects.toThrow('down');
});
