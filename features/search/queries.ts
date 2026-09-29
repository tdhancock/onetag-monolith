// Read hooks for search (ONE-48).
//
// Each takes the *debounced* term (lib/useDebouncedValue) — the screen waits
// for typing to pause, and TanStack Query dedupes identical requests in
// flight. There is no hand-written guard; the cache is the guard. The last
// results stay up while the next search runs.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { postsByAuthors, searchPosts, searchProducts, searchProfiles, searchProjects } from './api';
import { searchKeys } from './keys';

const options = { placeholderData: keepPreviousData, staleTime: 30_000 } as const;

/** The newest posts by the profiles a search matched (see postsByAuthors). */
export const usePostsByAuthorsQuery = (profileIds: readonly string[]) =>
  useQuery({
    queryKey: searchKeys.postsByAuthors(profileIds),
    queryFn: () => postsByAuthors(profileIds),
    enabled: profileIds.length > 0,
    ...options,
  });

export const useProfileResultsQuery = (term: string) => {
  const t = term.trim();
  return useQuery({ queryKey: searchKeys.profiles(t), queryFn: () => searchProfiles(t), enabled: t.length > 0, ...options });
};

export const usePostResultsQuery = (term: string) => {
  const t = term.trim();
  return useQuery({ queryKey: searchKeys.posts(t), queryFn: () => searchPosts(t), enabled: t.length > 0, ...options });
};

export const useProductResultsQuery = (term: string, category: string | null) => {
  const t = term.trim();
  return useQuery({
    queryKey: searchKeys.products(t, category),
    queryFn: () => searchProducts(t, category),
    enabled: t.length > 0,
    ...options,
  });
};

export const useProjectResultsQuery = (term: string, category: string | null, publicOnly = false) => {
  const t = term.trim();
  return useQuery({
    queryKey: searchKeys.projects(t, category, publicOnly),
    queryFn: () => searchProjects(t, category, publicOnly),
    enabled: t.length > 0,
    ...options,
  });
};
