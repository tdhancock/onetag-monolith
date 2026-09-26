/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/TagResolution.test.tsx
//
// The tag resolution route, app/t/[shortCode].tsx (ONE-30), mounted over the
// real tags feature and a real query client — only the Supabase client, the
// router and who is signed in are faked:
//
//   * a live tag replaces the route with its destination and records a scan
//     against the active profile — or against nobody when signed out;
//   * on a cold start it waits for the session rather than guessing, and
//     gives up waiting after a bounded time;
//   * a failed scan never stops the redirect, and one resolution writes one
//     scan;
//   * unknown, paused, offline and destination-less tags each get a screen
//     with somewhere to go.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => require('../support/reactNativeDom'));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockParams: { shortCode?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

const mockWho = {
  auth: 'signed-in' as 'unknown' | 'signed-in' | 'signed-out',
  profile: { status: 'ready', profileId: 'p-biz' as string | undefined },
};
jest.mock('../../features/auth', () => ({ useAuthStatus: () => mockWho.auth }));
jest.mock('../../features/profiles', () => ({ useCurrentProfile: () => mockWho.profile }));

const mockRpc = jest.fn();
const mockInsert = jest.fn();
jest.mock('../../services/supabase.native', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));

import TagResolutionScreen from '../../app/t/[shortCode]';
import { SCAN_ATTRIBUTION_WAIT_MS } from '../../lib/screens/tagResolution';

const CODE = 'ABC23XYZ';
const LIVE_PROFILE = { tag_id: 'tag-1', active: true, dest_profile_id: 'p-ana', dest_profile_username: 'ana' };
const PAUSED = { tag_id: null, active: false, dest_profile_id: null, dest_profile_username: null };

/** resolve_tag answers with each result in turn, then keeps repeating the last. */
function resolveWith(...results: { data: unknown; error?: unknown; status?: number }[]) {
  let call = 0;
  mockRpc.mockImplementation(() => ({
    maybeSingle: () => {
      const result = results[Math.min(call++, results.length - 1)];
      return Promise.resolve({ error: null, status: 200, ...result });
    },
  }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

const tree = () => (
  <QueryClientProvider client={client}>
    <TagResolutionScreen />
  </QueryClientProvider>
);

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(tree()));
  return container;
}

/** Re-render after changing who is signed in. */
const rerender = () => act(() => root!.render(tree()));

/** Let queries, mutations and effects run. */
async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const button = (el: HTMLElement, label: string) => buttons(el).find((b) => b.textContent === label);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  mockParams.shortCode = CODE;
  mockWho.auth = 'signed-in';
  mockWho.profile = { status: 'ready', profileId: 'p-biz' };
  [mockReplace, mockPush, mockRpc, mockInsert].forEach((m) => m.mockReset());
  mockInsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
  jest.useRealTimers();
});

// ─── A live tag ─────────────────────────────────────────────────────────

describe('a live tag', () => {
  it('shows a resolving state first, never a blank screen', () => {
    mockRpc.mockImplementation(() => ({ maybeSingle: () => new Promise(() => undefined) }));
    const el = mount();
    expect(el.textContent).toContain('Opening tag');
    expect(el.textContent).toContain(CODE);
  });

  it('replaces the route with its profile and records a scan against the active profile', async () => {
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await settle();

    expect(mockRpc).toHaveBeenCalledWith('resolve_tag', { p_short_code: CODE });
    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
    expect(mockInsert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: 'p-biz' });
  });

  it('never pushes — Back must not return to a screen that redirects again', async () => {
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await settle();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('writes exactly one scan, however often it re-renders', async () => {
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await settle();
    rerender();
    rerender();
    await settle();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

// ─── Who the scan belongs to ────────────────────────────────────────────

describe('scan attribution', () => {
  it('resolves signed out, and records the scan with a null scanner — no session needed', async () => {
    mockWho.auth = 'signed-out';
    mockWho.profile = { status: 'signed-out', profileId: undefined };
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await settle();

    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
    expect(mockInsert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: null });
  });

  it('on a cold start, waits for the session instead of recording a signed-in scan as anonymous', async () => {
    mockWho.auth = 'unknown';
    mockWho.profile = { status: 'signed-out', profileId: undefined };
    resolveWith({ data: LIVE_PROFILE });
    const el = mount();
    await settle();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Opening tag');

    mockWho.auth = 'signed-in';
    mockWho.profile = { status: 'loading', profileId: undefined };
    rerender();
    await settle();
    expect(mockInsert).not.toHaveBeenCalled();

    mockWho.profile = { status: 'ready', profileId: 'p-biz' };
    rerender();
    await settle();
    expect(mockInsert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: 'p-biz' });
    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
  });

  it('stops waiting for a session that never settles, and goes on as anonymous', async () => {
    jest.useFakeTimers();
    mockWho.auth = 'unknown';
    mockWho.profile = { status: 'signed-out', profileId: undefined };
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SCAN_ATTRIBUTION_WAIT_MS);
    });
    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
    expect(mockInsert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: null });
  });
});

// ─── A scan that fails ──────────────────────────────────────────────────

describe('a scan that fails to record', () => {
  it('still reaches the destination, and shows no error', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } });
    resolveWith({ data: LIVE_PROFILE });
    const el = mount();
    await settle();

    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
    expect(el.textContent).not.toMatch(/wrong|error|didn't open/i);
  });

  it('still reaches the destination when the insert never answers', async () => {
    mockInsert.mockImplementation(() => new Promise(() => undefined));
    resolveWith({ data: LIVE_PROFILE });
    mount();
    await settle();
    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
  });
});

// ─── Failures ───────────────────────────────────────────────────────────

describe('failure states', () => {
  it('shows not-found for an unknown code, with a way into the app', async () => {
    resolveWith({ data: null });
    const el = mount();
    await settle();

    expect(el.textContent).toContain("This tag isn't recognized.");
    button(el, 'Go to OneTag')!.click();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('shows not-found for a malformed code without querying at all', async () => {
    mockParams.shortCode = 'not-a-code';
    const el = mount();
    await settle();
    expect(el.textContent).toContain("This tag isn't recognized.");
    // The hostile path segment is not echoed back.
    expect(el.textContent).not.toContain('not-a-code');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('shows the inactive state for a paused tag, distinct from not-found', async () => {
    resolveWith({ data: PAUSED });
    const el = mount();
    await settle();

    expect(el.textContent).toContain('This tag is no longer active.');
    expect(el.textContent).not.toContain("isn't recognized");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('offers a stranger sign up and sign in, never a dead end', async () => {
    mockWho.auth = 'signed-out';
    mockWho.profile = { status: 'signed-out', profileId: undefined };
    resolveWith({ data: PAUSED });
    const el = mount();
    await settle();

    button(el, 'Join OneTag')!.click();
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/signup');
    button(el, 'Sign in')!.click();
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('shows the destination-missing state when a live tag has nowhere to go', async () => {
    resolveWith({ data: { ...LIVE_PROFILE, dest_profile_username: null } });
    const el = mount();
    await settle();
    expect(el.textContent).toContain('What this tag pointed to is gone.');
    expect(button(el, 'Go to OneTag')).toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('shows offline with a retry, and the retry resolves the tag', async () => {
    resolveWith(
      { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      { data: LIVE_PROFILE },
    );
    const el = mount();
    await settle();

    expect(el.textContent).toContain("You're offline.");
    // Offline is not retried behind the person's back — they choose to.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(button(el, 'Go to OneTag')).toBeDefined();

    button(el, 'Try again')!.click();
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenCalledWith('/user/ana');
  });

  it('shows a failed state with a retry when the server refuses', async () => {
    resolveWith({ data: null, error: { message: 'boom', code: '500' }, status: 500 });
    const el = mount();
    await settle(10);
    expect(el.textContent).toContain("This tag didn't open.");
    expect(button(el, 'Try again')).toBeDefined();
  });
});
