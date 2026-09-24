// Realtime as something that tells the cache what changed.
//
// Before this, realtime was a *second write path*: `AppContext` opened its own
// raw `supabase.channel(...)` and wrote payloads straight into `setState`,
// competing with whatever else owned that data. Worse, its channel name
// embedded `Date.now()`, so every re-subscribe produced a uniquely named
// channel the registry in `services/realtime.ts` could never dedupe — stale
// channels accumulated for the life of the session.
//
// The bridge fixes both: it subscribes through the registry with a name
// derived from the table and filter alone, so the same stream is the same
// channel every time, and it hands changes to the query cache rather than to
// component state.
//
// Two behaviours here are easy to get wrong and are tested directly:
//
//   1. **Duplicates.** A row the user just created arrives twice — once as the
//      mutation's response, once as a realtime INSERT. `upsertById` is what
//      keeps them from seeing their own message twice.
//   2. **Reconnection.** Supabase drops the socket when the app backgrounds.
//      A second SUBSCRIBED means time passed unobserved, so the affected
//      queries are invalidated rather than left quietly stale.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { subscribe, type ChangePayload, type ChannelStatus } from '../services/realtime';

/** A row as Postgres sends it. */
export type RealtimeRow = Record<string, unknown>;

export interface RealtimeSyncOptions {
  /** The table to watch. */
  table: string;
  /** A PostgREST equality filter, e.g. `receiver_id=eq.<uuid>`. */
  filter: string;
  /**
   * The queries this stream affects. Invalidated on reconnect, and on any
   * change the handlers below do not deal with themselves.
   */
  queryKey: QueryKey;
  /** Skip subscribing entirely — typically while there is no user id yet. */
  enabled?: boolean;
  /** Called for an INSERT. Return true when it has been handled. */
  onInsert?: (row: RealtimeRow, queryClient: QueryClient) => boolean | void;
  /** Called for an UPDATE. Return true when it has been handled. */
  onUpdate?: (row: RealtimeRow, queryClient: QueryClient) => boolean | void;
  /** Called for a DELETE, with the row as it was. Return true when handled. */
  onDelete?: (row: RealtimeRow, queryClient: QueryClient) => boolean | void;
}

/**
 * The channel name for a stream.
 *
 * Derived from the table and filter and nothing else — no timestamp, no random
 * suffix — so two calls for the same stream produce the same name and the
 * registry can dedupe them. Exported for the test that pins exactly that.
 */
export const realtimeChannelName = (table: string, filter: string): string =>
  `realtime:${table}:${filter || 'all'}`;

/**
 * Put a row into a cached list without duplicating it.
 *
 * Returns the same array reference when nothing changed, so an echo of the
 * user's own insert is not a re-render.
 */
export const upsertById = <TRow extends { id?: unknown }>(
  list: TRow[] | undefined,
  row: TRow,
): TRow[] => {
  const existing = list ?? [];
  const index = existing.findIndex((item) => item.id === row.id);

  if (index === -1) return [row, ...existing];

  // Already there — the mutation's response beat the realtime echo. Keep the
  // list, but take the newer fields.
  const merged = { ...existing[index], ...row };
  const next = [...existing];
  next[index] = merged;
  return next;
};

/** Drop a row from a cached list by id. */
export const removeById = <TRow extends { id?: unknown }>(
  list: TRow[] | undefined,
  id: unknown,
): TRow[] => (list ?? []).filter((item) => item.id !== id);

/**
 * Subscribe a component to one realtime stream for as long as it is mounted.
 *
 * Handlers that return `true` have dealt with the change themselves; anything
 * else falls back to invalidating `queryKey`, which is correct but costs a
 * refetch. Prefer handling inserts directly — blanket invalidation on every
 * event defeats the caching this milestone is for.
 */
export const useRealtimeSync = ({
  table,
  filter,
  queryKey,
  enabled = true,
  onInsert,
  onUpdate,
  onDelete,
}: RealtimeSyncOptions): void => {
  const queryClient = useQueryClient();

  // The handlers are read through a ref so a caller passing inline arrows —
  // which every caller does — does not tear the channel down and rebuild it
  // on every render.
  const handlers = useRef({ onInsert, onUpdate, onDelete, queryKey });
  handlers.current = { onInsert, onUpdate, onDelete, queryKey };

  useEffect(() => {
    if (!enabled) return;

    const channelName = realtimeChannelName(table, filter);

    // The first SUBSCRIBED is this subscription starting. A later one is a
    // reconnection, and everything that happened while the socket was down
    // was missed.
    let hasConnected = false;

    const onChange = (payload: ChangePayload) => {
      const { onInsert: insert, onUpdate: update, onDelete: remove, queryKey: key } = handlers.current;

      const handled =
        payload.eventType === 'INSERT'
          ? insert?.(payload.new ?? {}, queryClient)
          : payload.eventType === 'UPDATE'
            ? update?.(payload.new ?? {}, queryClient)
            : remove?.(payload.old ?? {}, queryClient);

      if (handled !== true) queryClient.invalidateQueries({ queryKey: key });
    };

    const onStatus = (status: ChannelStatus) => {
      if (status !== 'SUBSCRIBED') return;

      if (hasConnected) {
        queryClient.invalidateQueries({ queryKey: handlers.current.queryKey });
      }
      hasConnected = true;
    };

    const subscription = subscribe(channelName, table, filter, onChange, onStatus);

    return () => {
      subscription.unsubscribe();
    };
  }, [table, filter, enabled, queryClient]);
};
