
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

// Active channels keyed by channel name — prevents accidental double-subscribe
// on the same logical stream within a single session.
const activeChannels = new Map<string, RealtimeSubscription>();

// How many callers are holding each channel, and who wants its events.
//
// Both sets exist because a shared channel has one `.on(...)` binding but
// possibly several listeners: the channel is opened once and every caller's
// handler is called from that single binding (ONE-16).
const subscriberCounts = new Map<string, number>();
const statusHandlers = new Map<string, Set<StatusHandler>>();
const changeHandlers = new Map<string, Set<ChangeHandler>>();

/**
 * Subscribe to Postgres Changes on `table` filtered by an equality clause
 * (e.g. `user_id=eq.abc`). Returns a handle whose `unsubscribe()` removes the
 * channel from Supabase's realtime manager.
 */
export function subscribe(
  channelName: string,
  table: string,
  filter: string,
  onChange: ChangeHandler,
  onStatus?: StatusHandler,
): RealtimeSubscription {
  // If a channel with this name already exists, hand back the existing handle
  // rather than leaking a second channel that would receive duplicate events.
  //
  // Each caller is counted: two screens watching the same stream share one
  // channel, and it is only torn down when the last of them lets go. Without
  // the count, the first unmount would silently deafen the other (ONE-16).
  const existing = activeChannels.get(channelName);
  if (existing) {
    subscriberCounts.set(channelName, (subscriberCounts.get(channelName) ?? 1) + 1);
    addChangeHandler(channelName, onChange);
    if (onStatus) addStatusHandler(channelName, onStatus);
    return existing;
  }

  addChangeHandler(channelName, onChange);
  if (onStatus) addStatusHandler(channelName, onStatus);

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
    for (const handler of statusHandlers.get(channelName) ?? []) {
      handler(status as ChannelStatus);
    }
  });

  const handle: RealtimeSubscription = {
    channelName,
    channel,
    unsubscribe: () => {
      if (!activeChannels.has(channelName)) return;

      changeHandlers.get(channelName)?.delete(onChange);
      if (onStatus) removeStatusHandler(channelName, onStatus);

      const remaining = (subscriberCounts.get(channelName) ?? 1) - 1;
      if (remaining > 0) {
        subscriberCounts.set(channelName, remaining);
        return;
      }

      supabase.removeChannel(channel);
      activeChannels.delete(channelName);
      subscriberCounts.delete(channelName);
      statusHandlers.delete(channelName);
      changeHandlers.delete(channelName);
    },
  };

  activeChannels.set(channelName, handle);
  subscriberCounts.set(channelName, 1);
  return handle;
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
  for (const handle of Array.from(activeChannels.values())) {
    // Drop the count to one first, so a channel several callers are holding
    // still goes away — this is full teardown, not one caller letting go.
    subscriberCounts.set(handle.channelName, 1);
    handle.unsubscribe();
  }
  activeChannels.clear();
  subscriberCounts.clear();
  statusHandlers.clear();
  changeHandlers.clear();
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
  subscriberCounts.clear();
  statusHandlers.clear();
  changeHandlers.clear();
}
