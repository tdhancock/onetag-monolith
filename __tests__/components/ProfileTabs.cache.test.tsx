/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ProfileTabs.cache.test.tsx
//
// The profile's tabs (ONE-43) against the real query cache: the screen is
// mounted over the real profiles, products, projects, saves and scans
// features and a query client with the app's staleness, and only the
// Supabase client (an in-memory database that logs every read), the router
// and the acting profile are faked. The render suite shows which tab hooks a
// screen asks for; this one shows what reaches the database.
//
//   1. On mount, only the first tab's content is read — the header's counts
//      are counts, never the posts.
//   2. A tab opened, left and opened again within the stale window is not
//      read a second time.
//   3. The Saves tab reads the saves once and each kind's targets once,
//      newest first, leaving out a target the viewer can no longer see.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const slot = (node: unknown) =>
    node == null ? null : React.isValidElement(node) ? node : React.createElement(node as React.FC);
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListHeaderComponent?: unknown;
    ListEmptyComponent?: unknown;
  }) =>
    React.createElement(
      'div',
      null,
      slot(props.ListHeaderComponent),
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
    );
  return {
    ...shim,
    FlatList,
    ScrollView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 375, height: 812 }),
    Linking: { openURL: jest.fn() },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: jest.fn() }) }));
jest.mock('../../lib/realtimeBridge', () => ({ useRealtimeSync: jest.fn() }));

const mockActing: { profile: Record<string, unknown>; profileId: string; authUserId: string } = {
  profile: {},
  profileId: 'p-biz',
  authUserId: 'a-me',
};
jest.mock('../../features/profiles', () => ({
  ...jest.requireActual('../../features/profiles'),
  useCurrentProfile: () => ({ ...mockActing, status: 'ready' }),
}));
jest.mock('../../features/auth', () => ({ useAuthUserId: () => 'a-me', useAuthStatus: () => 'signed-in' }));
jest.mock('../../services/supabase.native', () => require('../support/mockSupabaseDb').supabaseModule());

import { db, resetDb } from '../support/mockSupabaseDb';
import OwnProfileScreen from '../../app/(tabs)/profile';

// ─── The database ───────────────────────────────────────────────────────

const BUSINESS = { id: 'p-biz', user_id: 'a-me', username: 'oak_studio', full_name: 'Oak Studio', bio: '', avatar_url: null, is_verified: false, is_private: false, profile_type: 'business' };
const INDIVIDUAL = { id: 'p-me', user_id: 'a-me', username: 'me', full_name: 'Me', bio: '', avatar_url: null, is_verified: false, is_private: false, profile_type: 'individual' };

const seed = () => {
  resetDb({
    profiles: [BUSINESS, INDIVIDUAL, { ...INDIVIDUAL, id: 'p-ana', user_id: 'a-ana', username: 'ana', full_name: 'Ana Reyes' }],
    products: [{ id: 'pd-1', business_profile_id: 'p-biz', name: 'Oak door', category: 'Doors', price_cents: null, currency: 'USD', available: true, created_at: '2026-09-01T00:00:00Z' }],
    product_media: [],
    projects: [
      { id: 'pj-1', owner_profile_id: 'p-biz', name: 'Barn conversion', project_type: null, year: null, cover_url: null, is_public: true, created_at: '2026-09-02T00:00:00Z' },
      { id: 'pj-secret', owner_profile_id: 'p-ana', name: 'Secret loft', project_type: null, year: null, cover_url: null, is_public: false, created_at: '2026-09-03T00:00:00Z' },
    ],
    contributors: [],
    posts: [{ id: 'post-1', user_id: 'p-biz', content: 'Fresh from the shop', media_type: 'text', created_at: '2026-09-01T00:00:00Z' }],
    follows: [],
    saves: [
      { id: 's-post', profile_id: 'p-me', saved_post_id: 'post-1', saved_product_id: null, saved_project_id: null, saved_profile_id: null, saved_at: '2026-09-10T00:00:00Z' },
      { id: 's-product', profile_id: 'p-me', saved_post_id: null, saved_product_id: 'pd-1', saved_project_id: null, saved_profile_id: null, saved_at: '2026-09-09T00:00:00Z' },
      // Saved while it was public; since made private by its owner.
      { id: 's-secret', profile_id: 'p-me', saved_post_id: null, saved_product_id: null, saved_project_id: 'pj-secret', saved_profile_id: null, saved_at: '2026-09-08T00:00:00Z' },
      { id: 's-profile', profile_id: 'p-me', saved_post_id: null, saved_product_id: null, saved_project_id: null, saved_profile_id: 'p-ana', saved_at: '2026-09-07T00:00:00Z' },
    ],
  });
  db.visible = { projects: (row) => row.is_public === true || row.owner_profile_id === mockActing.profileId };
  db.embeds = {
    posts: (row) => ({ ...row, profiles: db.tables.profiles!.find((p) => p.id === row.user_id) }),
  };
};

// ─── Mounting ───────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <OwnProfileScreen />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}

const selectTab = async (el: HTMLElement, name: string) => {
  act(() => (el.querySelector(`button[aria-label="${name}"]`) as HTMLElement).click());
  await settle();
};

/** Reads of a table's rows — not a head-only count. */
const reads = (table: string) => db.reads.filter((r) => r.table === table && !r.head).length;

const actAs = (profile: typeof BUSINESS) => {
  mockActing.profile = {
    id: profile.id,
    username: profile.username,
    name: profile.full_name,
    profileType: profile.profile_type,
    scanHistoryPublic: false,
  };
  mockActing.profileId = profile.id;
};

beforeEach(() => {
  // The app's own staleness (lib/queryClient): a minute.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  seed();
  actAs(BUSINESS);
  mockPush.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

// ─── 1. Mounting ────────────────────────────────────────────────────────

describe('on mount', () => {
  it('reads only the first tab\'s content: a business\'s products', async () => {
    const el = await mount();
    expect(el.textContent).toContain('Oak Studio');
    expect(reads('products')).toBe(1);
    expect(reads('projects')).toBe(0);
    expect(reads('contributors')).toBe(0);
    expect(reads('saves')).toBe(0);
    // The header's Posts figure is a count; the posts themselves wait for Media.
    expect(reads('posts')).toBe(0);
    expect(db.reads.some((r) => r.table === 'posts' && r.head)).toBe(true);
    expect(db.rpcs.map((r) => r.name)).not.toContain('scan_history');
  });

  it('shows the Posts figure from the count', async () => {
    const el = await mount();
    expect(el.querySelector('[aria-label="1 Posts"]')).not.toBeNull();
  });
});

// ─── 2. The cache ───────────────────────────────────────────────────────

describe('within the stale window', () => {
  it('reads a tab once, however often it is opened again', async () => {
    const el = await mount();
    await selectTab(el, 'Projects');
    expect(reads('projects')).toBe(1);
    await selectTab(el, 'Products');
    await selectTab(el, 'Projects');
    await selectTab(el, 'Products');
    expect(reads('products')).toBe(1);
    expect(reads('projects')).toBe(1);
    expect(el.textContent).toContain('Oak door');
  });

  it('reads the posts only once Media is opened, and once', async () => {
    const el = await mount();
    await selectTab(el, 'Media');
    expect(reads('posts')).toBe(1);
    expect(el.querySelector('button[aria-label="Fresh from the shop"]')).not.toBeNull();
    await selectTab(el, 'Products');
    await selectTab(el, 'Media');
    expect(reads('posts')).toBe(1);
  });
});

// ─── 3. Saves ───────────────────────────────────────────────────────────

describe('the Saves tab', () => {
  beforeEach(() => actAs(INDIVIDUAL));

  it('reads nothing until opened, then the saves once and each kind once', async () => {
    const el = await mount();
    expect(reads('saves')).toBe(0);
    await selectTab(el, 'Saves');
    expect(reads('saves')).toBe(1);
    expect(reads('products')).toBe(1);
    expect(reads('projects')).toBe(1);
    expect(reads('posts')).toBe(2); // the Posts tab, and the saved post
    expect(el.textContent).toContain('Oak door');
  });

  it('lists every kind, newest first, leaving out a target the viewer can no longer see', async () => {
    const el = await mount();
    await selectTab(el, 'Saves');
    const labels = Array.from(el.querySelectorAll('button[aria-label]'))
      .map((b) => b.getAttribute('aria-label')!)
      .filter((label) => / · /.test(label));
    expect(labels).toEqual([
      'Fresh from the shop, Post · @oak_studio',
      'Oak door, Product · Doors',
      'Ana Reyes, Profile · @ana',
    ]);
    expect(el.textContent).not.toContain('Secret loft');
  });
});
