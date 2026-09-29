// The public surface of the search domain.
//
// Screens and other features import from `features/search`, never from a
// file inside it. See features/README.md.

export {
  searchProfiles,
  searchPosts,
  searchProducts,
  searchProjects,
  postsByAuthors,
  POSTS_BY_AUTHORS_SELECT,
  SEARCH_RESULT_LIMIT,
} from './api';
export { searchKeys } from './keys';
export {
  useProfileResultsQuery,
  usePostResultsQuery,
  usePostsByAuthorsQuery,
  useProductResultsQuery,
  useProjectResultsQuery,
} from './queries';
export type { SearchProfile, SearchPost, SearchProduct, SearchProject } from './types';
