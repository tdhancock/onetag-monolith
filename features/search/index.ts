// The public surface of the search domain.
//
// Screens and other features import from `features/search`, never from a
// file inside it. See features/README.md.

export { searchProfiles, searchPosts, searchProducts, searchProjects, SEARCH_RESULT_LIMIT } from './api';
export { searchKeys } from './keys';
export { useProfileResultsQuery, usePostResultsQuery, useProductResultsQuery, useProjectResultsQuery } from './queries';
export type { SearchProfile, SearchPost, SearchProduct, SearchProject } from './types';
