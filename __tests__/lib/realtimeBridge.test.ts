/**
 * @jest-environment jsdom
 */
//
// target: __tests__/lib/realtimeBridge.test.ts
//
// The realtime-to-cache bridge (ONE-16). Realtime used to be a second write
// path: a raw channel in AppContext writing payloads into `setState`, with a
// name that embedded `Date.now()` so every re-subscribe leaked a channel the
// registry could never dedupe.
//
// Four properties matter enough to pin down, and the ticket names three of
// them as the likely bugs:
//
//   1. The channel name is stable, so the registry can do its job.
//   2. Mount/unmount cycles return to baseline rather than accumulating.
//   3. A row the user just created arrives twice — as the mutation's response
//      and as a realtime INSERT — and must appear once.
//   4. A reconnection invalidates, because time passed unobserved.

const removeChannel = jest.fn();

interface FakeChannel {
  name: string;
  on: jest.Mock;
  subscribe: jest.Mock;
  changeHandler?: (payload: unknown) => void;
  statusHandler?: (status: string) => void;
}

const channelsCreated: FakeChannel[] = [];

jest.mock('../../services/supabase.native', () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  },
}), { virtual: true });

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../../services/supabase.native';
import { activeSubscriptionCount, __resetForTests } from '../../services/realtime';
import {
  useRealtimeSync,
  realtimeChannelName,
  upsertById,
  removeById,
} from '../../lib/realtimeBridge';

const channelMock = supabase.channel as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  channelsCreated.length = 0;
  __resetForTests();

  channelMock.mockImplementation((name: string) => {
    const channel: FakeChannel = {
      name,
      on: jest.fn((_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
        channel.changeHandler = handler;
        return channel;
      }),
      subscribe: jest.fn((handler?: (status: string) => void) => {
        channel.statusHandler = handler;
        return channel;
      }),
    };
    channelsCreated.push(channel);
    return channel;
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

interface MountedBridge {
  root: Root;
  container: HTMLDivElement;
}

/** Mount a component that does nothing but hold one subscription. */
const mountBridge = (
  client: QueryClient,
  options: Parameters<typeof useRealtimeSync>[0],
): MountedBridge => {
  const Probe: React.FC = () => {
    useRealtimeSync(options);
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(Probe)),
    );
  });

  return { root, container };
};

const unmountBridge = ({ root, container }: MountedBridge) => {
  act(() => root.unmount());
  container.remove();
};

const lastChannel = () => channelsCreated[channelsCreated.length - 1]!;

// ─── 1. Channel naming ──────────────────────────────────────────────────

describe('channel names', () => {
  it('is the same for the same stream, every time', () => {
    // The bug this replaced: `public:messages-realtime-${userId}-${Date.now()}`
    // was unique per call, so the registry could never match two of them.
    expect(realtimeChannelName('messages', 'receiver_id=eq.u1'))
      .toBe(realtimeChannelName('messages', 'receiver_id=eq.u1'));
  });

  it('differs between tables and between filters', () => {
    expect(realtimeChannelName('messages', 'receiver_id=eq.u1'))
      .not.toBe(realtimeChannelName('notifications', 'receiver_id=eq.u1'));
    expect(realtimeChannelName('messages', 'receiver_id=eq.u1'))
      .not.toBe(realtimeChannelName('messages', 'receiver_id=eq.u2'));
  });

  it('carries no timestamp or random suffix', () => {
    const name = realtimeChannelName('posts', '');
    expect(name).toBe('realtime:posts:all');
    expect(name).not.toMatch(/\d{10,}/);
  });
});

// ─── 2. Lifecycle ───────────────────────────────────────────────────────

describe('subscription lifecycle', () => {
  const options = { table: 'notifications', filter: 'receiver_id=eq.u1', queryKey: ['notifications'] };

  it('subscribes on mount and unsubscribes on unmount', () => {
    const client = newClient();

    const mounted = mountBridge(client, options);
    expect(activeSubscriptionCount()).toBe(1);

    unmountBridge(mounted);
    expect(activeSubscriptionCount()).toBe(0);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('returns to baseline across repeated mounts rather than accumulating', () => {
    const client = newClient();

    for (let i = 0; i < 5; i += 1) {
      unmountBridge(mountBridge(client, options));
    }

    expect(activeSubscriptionCount()).toBe(0);
  });

  it('opens one channel for two simultaneous subscribers, and keeps it until both let go', () => {
    // Two screens watching the same stream. The first unmount must not
    // deafen the second — the reason the registry counts holders.
    const client = newClient();

    const first = mountBridge(client, options);
    const second = mountBridge(client, options);

    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(activeSubscriptionCount()).toBe(1);

    unmountBridge(first);
    expect(activeSubscriptionCount()).toBe(1);
    expect(removeChannel).not.toHaveBeenCalled();

    unmountBridge(second);
    expect(activeSubscriptionCount()).toBe(0);
  });

  it('does not subscribe at all when disabled', () => {
    const client = newClient();

    const mounted = mountBridge(client, { ...options, enabled: false });

    expect(channelMock).not.toHaveBeenCalled();
    expect(activeSubscriptionCount()).toBe(0);

    unmountBridge(mounted);
  });
});

// ─── 3. Duplicates ──────────────────────────────────────────────────────

describe('upsertById', () => {
  it('adds a row that is not there yet, newest first', () => {
    expect(upsertById([{ id: 'a' }], { id: 'b' })).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('does not duplicate a row the cache already holds', () => {
    // The case the ticket calls the most likely bug: the user's own message
    // arrives as the mutation's response and again as a realtime INSERT.
    const list = [{ id: 'm1', text: 'hello' }];

    expect(upsertById(list, { id: 'm1', text: 'hello' })).toHaveLength(1);
  });

  it('takes the newer fields when the row is already there', () => {
    // A realtime UPDATE carries only the columns that changed.
    const list: Record<string, unknown>[] = [{ id: 'm1', text: 'hello', seen: false }];

    expect(upsertById(list, { id: 'm1', seen: true })).toEqual([
      { id: 'm1', text: 'hello', seen: true },
    ]);
  });

  it('handles an empty cache', () => {
    expect(upsertById(undefined, { id: 'a' })).toEqual([{ id: 'a' }]);
  });
});

describe('removeById', () => {
  it('drops the row and leaves the rest', () => {
    expect(removeById([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
  });

  it('is a no-op for a row that is not there', () => {
    expect(removeById([{ id: 'a' }], 'zzz')).toEqual([{ id: 'a' }]);
  });
});

// ─── 4. Events and reconnection ─────────────────────────────────────────

describe('handling changes', () => {
  const options = { table: 'notifications', filter: 'receiver_id=eq.u1', queryKey: ['notifications'] };

  it('hands an INSERT to the handler rather than invalidating', () => {
    const client = newClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const onInsert = jest.fn(() => true);

    const mounted = mountBridge(client, { ...options, onInsert });

    act(() => {
      lastChannel().changeHandler!({
        eventType: 'INSERT',
        schema: 'public',
        table: 'notifications',
        new: { id: 'n1' },
      });
    });

    expect(onInsert).toHaveBeenCalledWith({ id: 'n1' }, client);
    expect(invalidate).not.toHaveBeenCalled();

    unmountBridge(mounted);
  });

  it('falls back to invalidating when nothing handled the change', () => {
    const client = newClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const mounted = mountBridge(client, options);

    act(() => {
      lastChannel().changeHandler!({
        eventType: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        new: { id: 'n1' },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });

    unmountBridge(mounted);
  });

  it('invalidates on reconnect, but not on the first connection', () => {
    // Supabase drops the socket when the app backgrounds. The first
    // SUBSCRIBED is this subscription starting and the data is already fresh;
    // a second one means time passed unobserved.
    const client = newClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const mounted = mountBridge(client, options);

    act(() => { lastChannel().statusHandler!('SUBSCRIBED'); });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => { lastChannel().statusHandler!('CLOSED'); });
    act(() => { lastChannel().statusHandler!('SUBSCRIBED'); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });

    unmountBridge(mounted);
  });
});
