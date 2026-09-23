// The one implementation of "optimistic boolean toggle over a join table".
//
// Like, Repost, Save and Follow are the same operation wearing four costumes:
// flip a boolean, move a count by one, call the server, and put everything
// back exactly as it was if the call fails. Each used to carry its own
// rollback — four chances to get it subtly wrong, and the one that mattered
// (the count in a feed list) was not handled at all.
//
// Rollback correctness is the whole point of this file, so the cache work is
// pure and exported: `toggled`, `patchEntity` and `patchLists` are testable
// without a renderer, and `toggleMutationOptions` assembles them into the
// TanStack optimistic cycle — cancel, snapshot, apply; restore on error;
// invalidate on settle.
//
// The entity is the source of truth for the current state. Callers pass an id,
// not a desired value, so two taps cannot disagree about what "on" meant.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/** What this toggle flips, and where the entity lives in the cache. */
export interface OptimisticToggleConfig<TEntity> {
  /** The server call. Resolves on success, throws to trigger rollback. */
  mutationFn: (id: string) => Promise<unknown>;
  /** The entity's detail key. */
  entityKey: (id: string) => QueryKey;
  /**
   * Prefix of every cached list that may also hold this entity — the feed's
   * `useInfiniteQuery` pages, a profile grid, a search result. Every cached
   * query under this prefix whose data has `pages` is patched and, on
   * failure, restored. A post liked from the feed must not leave a stale
   * count behind in the list it was liked from.
   */
  listKey: QueryKey;
  /** Where the boolean lives on the entity. */
  isOn: (entity: TEntity) => boolean;
  /** Where the paired count lives. */
  count: (entity: TEntity) => number;
  /** Build the updated entity. Pure — no mutation of the original. */
  apply: (entity: TEntity, next: { isOn: boolean; count: number }) => TEntity;
  /** How to recognise the entity inside a list page. */
  entityId: (entity: TEntity) => string;
  /**
   * Fired the instant the optimistic value is written, before any network
   * call. Haptics hang here so the tap still feels immediate.
   */
  onToggle?: (next: { isOn: boolean }) => void;
}

/** What onMutate hands to onError so it can put everything back. */
export interface ToggleSnapshot<TEntity> {
  entity: [QueryKey, TEntity | undefined];
  lists: [QueryKey, unknown][];
}

// ---------------------------------------------------------------------------
// Pure cache transforms
// ---------------------------------------------------------------------------

/** The entity with its boolean flipped and its count moved to match. */
export const toggled = <TEntity>(
  entity: TEntity,
  config: Pick<OptimisticToggleConfig<TEntity>, 'isOn' | 'count' | 'apply'>,
): TEntity => {
  const nextOn = !config.isOn(entity);

  return config.apply(entity, {
    isOn: nextOn,
    // A count can only be dragged below zero by a cache that was already
    // wrong; clamping keeps that from rendering as "-1 likes".
    count: Math.max(0, config.count(entity) + (nextOn ? 1 : -1)),
  });
};

/** Apply a transform to a cached detail entry, leaving an empty one alone. */
export const patchEntity = <TEntity>(
  entity: TEntity | undefined,
  transform: (entity: TEntity) => TEntity,
): TEntity | undefined => (entity === undefined ? undefined : transform(entity));

const hasPages = (data: unknown): data is InfiniteData<unknown[], unknown> =>
  typeof data === 'object' &&
  data !== null &&
  Array.isArray((data as { pages?: unknown }).pages);

/**
 * Apply a transform to one entity wherever it appears across an infinite
 * query's pages.
 *
 * Returns the same reference when the entity is not in this list, so patching
 * every cached list costs nothing for the ones that do not hold it.
 */
export const patchLists = <TEntity>(
  data: unknown,
  id: string,
  entityId: (entity: TEntity) => string,
  transform: (entity: TEntity) => TEntity,
): unknown => {
  if (!hasPages(data)) return data;

  const pages = data.pages as TEntity[][];
  if (!pages.some((page) => page.some((entity) => entityId(entity) === id))) return data;

  return {
    ...data,
    pages: pages.map((page) =>
      page.some((entity) => entityId(entity) === id)
        ? page.map((entity) => (entityId(entity) === id ? transform(entity) : entity))
        : page,
    ),
  };
};

// ---------------------------------------------------------------------------
// The mutation cycle
// ---------------------------------------------------------------------------

/**
 * The full optimistic cycle for one toggle, as plain mutation options.
 *
 * Separate from the hook so the rollback can be driven against a real
 * QueryClient in tests without mounting a component.
 */
export const toggleMutationOptions = <TEntity>(
  queryClient: QueryClient,
  config: OptimisticToggleConfig<TEntity>,
) => ({
  mutationFn: (id: string) => config.mutationFn(id),

  onMutate: async (id: string): Promise<ToggleSnapshot<TEntity>> => {
    const entityKey = config.entityKey(id);

    // An in-flight read would otherwise land after the optimistic write and
    // overwrite it with the pre-toggle server value.
    await queryClient.cancelQueries({ queryKey: entityKey });
    await queryClient.cancelQueries({ queryKey: config.listKey });

    const previousEntity = queryClient.getQueryData<TEntity>(entityKey);
    const previousLists = queryClient
      .getQueriesData({ queryKey: config.listKey })
      .filter(([, data]) => hasPages(data));

    const transform = (entity: TEntity) => toggled(entity, config);

    queryClient.setQueryData<TEntity>(entityKey, (entity) => patchEntity(entity, transform));

    for (const [key] of previousLists) {
      queryClient.setQueryData(key, (data: unknown) =>
        patchLists<TEntity>(data, id, config.entityId, transform),
      );
    }

    // Read the state back off the cache rather than recomputing it, so the
    // caller is told what actually landed.
    const applied = queryClient.getQueryData<TEntity>(entityKey);
    if (applied !== undefined) config.onToggle?.({ isOn: config.isOn(applied) });
    else config.onToggle?.({ isOn: !(previousEntity && config.isOn(previousEntity)) });

    return {
      entity: [entityKey, previousEntity],
      lists: previousLists as [QueryKey, unknown][],
    };
  },

  onError: (_error: unknown, _id: string, snapshot: ToggleSnapshot<TEntity> | undefined) => {
    if (!snapshot) return;

    const [entityKey, previousEntity] = snapshot.entity;
    queryClient.setQueryData(entityKey, previousEntity);

    for (const [key, data] of snapshot.lists) {
      queryClient.setQueryData(key, data);
    }
  },

  onSettled: async (_data: unknown, _error: unknown, id: string) => {
    await queryClient.invalidateQueries({ queryKey: config.entityKey(id) });
    await queryClient.invalidateQueries({ queryKey: config.listKey });
  },
});

/**
 * A toggle mutation: `mutate(entityId)` flips the boolean everywhere the
 * entity is cached, and puts it all back if the server refuses.
 */
export const useOptimisticToggle = <TEntity>(config: OptimisticToggleConfig<TEntity>) => {
  const queryClient = useQueryClient();

  return useMutation(toggleMutationOptions(queryClient, config));
};
