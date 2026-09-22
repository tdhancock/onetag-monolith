// The one place a query key's *shape* is defined.
//
// Every domain's keys.ts calls `createQueryKeys('<domain>')`, so all keys come
// out hierarchical in the same way and broad invalidation works without anyone
// reasoning about array prefixes at the call site.
//
// TanStack Query matches queries by key *prefix*, which is the whole reason
// the shape matters: `['posts']` matches `['posts', 'list', {...}]` and
// `['posts', 'detail', 'p1']`, so invalidating `postKeys.all` reaches every
// key below it. The factory builds `lists()` and `details()` out of `all`
// rather than repeating the domain string, so that containment is structural
// and cannot be broken by a typo.

/**
 * Hierarchical query keys for one domain.
 *
 * ```ts
 * const postKeys = createQueryKeys('posts');
 *
 * postKeys.all                    // ['posts']
 * postKeys.lists()                // ['posts', 'list']
 * postKeys.list({ userId: 'u1' }) // ['posts', 'list', { userId: 'u1' }]
 * postKeys.details()              // ['posts', 'detail']
 * postKeys.detail('p1')           // ['posts', 'detail', 'p1']
 * ```
 *
 * A domain that needs more than this spreads the result and adds its own,
 * building them from `all` so they stay inside the hierarchy.
 */
export const createQueryKeys = <TDomain extends string>(domain: TDomain) => {
  const all = [domain] as const;
  const lists = () => [...all, 'list'] as const;
  const details = () => [...all, 'detail'] as const;

  return {
    /** Everything in this domain. Invalidating this invalidates all of it. */
    all,
    /** Every list in this domain, regardless of filters. */
    lists,
    /**
     * One filtered list. The filter object is part of the key, so two
     * different filters are two different cache entries.
     */
    list: <TFilters>(filters: TFilters) => [...lists(), filters] as const,
    /** Every detail in this domain. */
    details,
    /** One record by id. */
    detail: (id: string) => [...details(), id] as const,
  };
};

export type QueryKeyFactory<TDomain extends string = string> = ReturnType<
  typeof createQueryKeys<TDomain>
>;
