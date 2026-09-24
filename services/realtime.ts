
//
// Realtime subscription helper for Supabase Postgres Changes / Broadcast.
//
// Wraps `supabase.channel()` with a small, well-defined lifecycle:
//   subscribe(channelName, filter, onChange)  -> subscription handle
//   unsubscribe(handle)                        -> removes channel + clears handle
//
// The helper is intentionally framework-agnostic so it can be used from
// React effects (cleanup on unmount), plain event handlers, or background
// watchers. Each handle tracks the underlying channel so cleanup is
// deterministic — calling unsubscribe twice is a safe no-op.

import { supabase } from './supabase.native';

export type ChangePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  schema: string;
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export type ChangeHandler = (payload: ChangePayload) => void;

export type RealtimeSubscription = {
  channelName: string;
  channel: ReturnType<typeof supabase.channel>;
  unsubscribe: () => void;
};

/**
 * Connection status, as Supabase reports it to `channel.subscribe()`.
 *
 * `SUBSCRIBED` arriving a second time means the channel reconnected — after
 * backgrounding, say — and whatever happened in between was missed. Callers
 * use that to refetch rather than quietly showing stale data (ONE-16).
 */
export type ChannelStatus = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT';

export type StatusHandler = (status: ChannelStatus) => void;

// Live channels keyed by channel name — prevents accidental double-subscribe
// on the same logical stream within a single session.
const activeChannels = new Map<string, ReturnType<typeof supabase.channel>>();

// How many callers are holding each channel, and who wants its events.
//
// Both sets exist because a shared channel has one `.on(...)` binding but
// possibly several listeners: the channel is opened once and every caller's
// handler is called from that single binding (ONE-16).
const subscriberCounts = new Map<string, number>();
const statusHandlers = new Map<string, Set<StatusHandler>>();
const changeHandlers = new Map<string, Set<ChangeHandler>>();

// The last status each channel reported, so a caller joining a channel that
// is already open can be told it is connected (see `subscribe`).
const lastStatuses = new Map<string, ChannelStatus>();

/**
 * Subscribe to Postgres Changes on `table` filtered by an equality clause
 * (e.g. `user_id=eq.abc`). Returns a handle whose `unsubscribe()` releases
 * this caller, and removes the channel from Supabase's realtime manager once
 * no caller is left holding it.
 */
export function subscribe(
  channelName: string,
  table: string,
  filter: string,
  onChange: ChangeHandler,
  onStatus?: StatusHandler,
): RealtimeSubscription {
  // Each caller registers its own listener, wrapped so that two callers
  // passing the same function still hold two entries — releasing one must
  // not deafen the other.
  const changeListener: ChangeHandler = (change) => onChange(change);
  const statusListener: StatusHandler | undefined = onStatus && ((status) => onStatus(status));

  addChangeHandler(channelName, changeListener);
  if (statusListener) addStatusHandler(channelName, statusListener);

  // If a channel with this name already exists, share it rather than leaking
  // a second channel that would receive duplicate events.
  //
  // Each caller is counted: two screens watching the same stream share one
  // channel, and it is only torn down when the last of them lets go. Without
  // the count, the first unmount would silently deafen the other (ONE-16).
  const shared = activeChannels.get(channelName);
  const channel = shared ?? openChannel(channelName, table, filter);
  subscriberCounts.set(channelName, (subscriberCounts.get(channelName) ?? 0) + 1);

  // A late joiner missed the SUBSCRIBED that opened the channel. Replay it,
  // so the caller's first *reconnect* is recognised as one rather than
  // mistaken for the subscription starting.
  if (shared && statusListener && lastStatuses.get(channelName) === 'SUBSCRIBED') {
    statusListener('SUBSCRIBED');
  }

  // Every caller gets its own handle, which releases only its own listeners.
  // Handing a late joiner the first caller's handle meant the joiner's
  // unmount removed the *first* caller's handler and left its own running.
  let released = false;

  return {
    channelName,
    channel,
    unsubscribe: () => {
      // A handle outlives its channel after `unsubscribeAll()`; releasing it
      // then must not touch a newer channel opened under the same name.
      if (released || activeChannels.get(channelName) !== channel) return;
      released = true;

      changeHandlers.get(channelName)?.delete(changeListener);
      if (statusListener) removeStatusHandler(channelName, statusListener);

      const remaining = (subscriberCounts.get(channelName) ?? 1) - 1;
      if (remaining > 0) {
        subscriberCounts.set(channelName, remaining);
        return;
      }

      closeChannel(channelName);
    },
  };
}

/** Open one channel, with a single binding that fans out to every listener. */
function openChannel(channelName: string, table: string, filter: string) {
  const channel = supabase.channel(channelName);

  channel.on(
    'postgres_changes' as any,
    { event: '*', schema: 'public', table, filter } as any,
    (payload: any) => {
      const change: ChangePayload = {
        eventType: payload.eventType,
        schema: payload.schema,
        table: payload.table,
        new: payload.new ?? null,
        old: payload.old ?? null,
      };

      for (const handler of changeHandlers.get(channelName) ?? []) {
        handler(change);
      }
    },
  );

  channel.subscribe((status: string) => {
    lastStatuses.set(channelName, status as ChannelStatus);
    for (const handler of statusHandlers.get(channelName) ?? []) {
      handler(status as ChannelStatus);
    }
  });

  activeChannels.set(channelName, channel);
  return channel;
}

/** Remove a channel from Supabase and forget everything about it. */
function closeChannel(channelName: string): void {
  const channel = activeChannels.get(channelName);
  if (channel) supabase.removeChannel(channel);

  activeChannels.delete(channelName);
  subscriberCounts.delete(channelName);
  statusHandlers.delete(channelName);
  changeHandlers.delete(channelName);
  lastStatuses.delete(channelName);
}

/** Stop calling `handler` for this channel, without touching the channel. */
export function removeStatusHandler(channelName: string, handler: StatusHandler): void {
  const handlers = statusHandlers.get(channelName);
  if (!handlers) return;

  handlers.delete(handler);
  if (handlers.size === 0) statusHandlers.delete(channelName);
}

function addChangeHandler(channelName: string, handler: ChangeHandler): void {
  const handlers = changeHandlers.get(channelName) ?? new Set<ChangeHandler>();
  handlers.add(handler);
  changeHandlers.set(channelName, handlers);
}

function addStatusHandler(channelName: string, handler: StatusHandler): void {
  const handlers = statusHandlers.get(channelName) ?? new Set<StatusHandler>();
  handlers.add(handler);
  statusHandlers.set(channelName, handlers);
}

/**
 * Unsubscribe and clean up a subscription handle. Safe to call multiple
 * times — subsequent calls are no-ops.
 */
export function unsubscribe(handle: RealtimeSubscription): void {
  handle.unsubscribe();
}

/**
 * Remove every active subscription. Intended for tests and full-session
 * teardown (e.g. on logout).
 */
export function unsubscribeAll(): void {
  // Full teardown, not one caller letting go: every channel goes, however
  // many callers are holding it.
  for (const channelName of Array.from(activeChannels.keys())) {
    closeChannel(channelName);
  }
}

/**
 * Test/dev introspection — number of live channels.
 */
export function activeSubscriptionCount(): number {
  return activeChannels.size;
}

/**
 * Test-only reset. Drops the live-channel map WITHOUT notifying Supabase.
 * Used by the realtime test suite to keep tests hermetic — production code
 * should always go through `unsubscribe()` / `unsubscribeAll()`.
 */
export function __resetForTests(): void {
  activeChannels.clear();
  lastStatuses.clear();
  subscriberCounts.clear();
  statusHandlers.clear();
  changeHandlers.clear();
}
