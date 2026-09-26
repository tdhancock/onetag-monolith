/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/scans/scanHistory.test.tsx
//
// Scan History (ONE-35) in the app. The privacy itself is enforced by the
// database and tested at the API level in supabase/tests/scan_history.test.sql;
// this suite covers what the app does with what the database returns:
//
//   1. A scan_history row becomes one entry per destination, with its count
//      and latest time, and routes where scanning the tag again would.
//   2. The screen, app/scans.tsx, lists the active profile's own history
//      whatever its setting, says who can see it, and routes each row; with a
//      profile param it reads that profile's public history instead.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const slot = (node: unknown) =>
    typeof node === 'function' ? React.createElement(node as React.ComponentType) : (node as React.ReactNode) ?? null;
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
  return { ...shim, FlatList };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../../support/expoImageStub'));

const mockPush = jest.fn();
const mockParams: { current: Record<string, string> } = { current: {} };
const mockTitle: { current?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams.current,
  Stack: {
    Screen: (p: { options?: { title?: string } }) => {
      mockTitle.current = p.options?.title;
      return null;
    },
  },
}));

const mockActing = { profileId: 'p-me', profile: { id: 'p-me', username: 'me', scanHistoryPublic: false } };
jest.mock('../../../features/profiles', () => ({ useCurrentProfile: () => mockActing }));

const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import ScanHistoryScreen from '../../../app/scans';
import { mapScanHistoryRow, scanKeys, type ScanHistoryRow } from '../../../features/scans';
import { routeForEntry, scanHistorySummary } from '../../../lib/screens/scanHistory';

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const PROFILE_ROW: ScanHistoryRow = {
  dest_kind: 'profile',
  dest_id: 'p-xavi',
  dest_name: 'Xavi Ortiz',
  dest_username: 'xavi',
  scan_count: '10',
  last_scanned_at: TWO_HOURS_AGO,
};
const PRODUCT_ROW: ScanHistoryRow = {
  dest_kind: 'product',
  dest_id: 'pd-1',
  dest_name: 'Oak door',
  dest_username: null,
  scan_count: 1,
  last_scanned_at: TWO_HOURS_AGO,
};

// ─── 1. Entries ─────────────────────────────────────────────────────────

describe('a history entry', () => {
  it('is one destination, with its count and latest time', () => {
    expect(mapScanHistoryRow(PROFILE_ROW)).toEqual({
      key: 'profile:p-xavi',
      kind: 'profile',
      destinationId: 'p-xavi',
      name: 'Xavi Ortiz',
      username: 'xavi',
      scanCount: 10,
      lastScannedAt: TWO_HOURS_AGO,
    });
  });

  it('reads as how often and when', () => {
    expect(scanHistorySummary(mapScanHistoryRow(PROFILE_ROW))).toBe('Scanned 10 times · 2h');
    expect(scanHistorySummary(mapScanHistoryRow(PRODUCT_ROW))).toBe('Scanned once · 2h');
  });

  it('routes a profile where scanning the tag again would', () => {
    expect(routeForEntry(mapScanHistoryRow(PROFILE_ROW))).toBe('/user/xavi');
  });

  it('does not route a product or project until their screens exist (ONE-40, ONE-41)', () => {
    expect(routeForEntry(mapScanHistoryRow(PRODUCT_ROW))).toBeNull();
    expect(routeForEntry(mapScanHistoryRow({ ...PRODUCT_ROW, dest_kind: 'project' }))).toBeNull();
  });

  it('is keyed per profile, so a switch reads the other profile\'s history', () => {
    expect(scanKeys.history('p-me')).toEqual(['scans', 'history', 'p-me']);
    expect(scanKeys.history('p-me')).not.toEqual(scanKeys.history('p-studio'));
  });
});

// ─── 2. The screen ──────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <ScanHistoryScreen />
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return container;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockParams.current = {};
  mockActing.profile.scanHistoryPublic = false;
  mockPush.mockClear();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [PRODUCT_ROW, PROFILE_ROW], error: null });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

const rowFor = (el: HTMLElement, name: string) =>
  el.querySelector(`[aria-label^="${name},"]`) as HTMLElement | null;

describe('your scan history', () => {
  it('reads the active profile\'s history, one row per destination, most recent first', async () => {
    const el = await mount();
    expect(mockRpc).toHaveBeenCalledWith('scan_history', { p_profile_id: 'p-me' });
    expect(mockTitle.current).toBe('Scan history');
    const text = el.textContent ?? '';
    expect(text).toContain('Oak doorProduct · Scanned once · 2h');
    expect(text).toContain('Xavi OrtizProfile · Scanned 10 times · 2h');
    expect(text.indexOf('Oak door')).toBeLessThan(text.indexOf('Xavi Ortiz'));
    // A product has no screen yet (ONE-40), so its row is not a button — but
    // it still reads as one labelled element (ONE-87).
    const product = rowFor(el, 'Oak door')!;
    expect(product.getAttribute('aria-label')).toBe('Oak door, Product, Scanned once · 2h');
    expect(product.tagName).not.toBe('BUTTON');
    expect(rowFor(el, 'Xavi Ortiz')!.tagName).toBe('BUTTON');
  });

  it('routes a row to its destination', async () => {
    const el = await mount();
    act(() => rowFor(el, 'Xavi Ortiz')!.click());
    expect(mockPush).toHaveBeenCalledWith('/user/xavi');
  });

  it('says who can see it, and leads to the setting', async () => {
    const el = await mount();
    expect(el.textContent).toContain('Only you can see the tags you have scanned.');
    act(() => (el.querySelector('button[aria-label$="Change in Settings"]') as HTMLElement).click());
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('shows everything to its owner even while public', async () => {
    mockActing.profile.scanHistoryPublic = true;
    const el = await mount();
    expect(el.textContent).toContain('Anyone can see the tags you have scanned');
    expect(rowFor(el, 'Xavi Ortiz')).not.toBeNull();
  });

  it('explains an empty history', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const el = await mount();
    expect(el.textContent).toContain('No scans yet');
    expect(el.textContent).toContain('Tags you scan with your camera show up here');
  });
});

describe('someone else\'s public history', () => {
  it('reads that profile\'s history, titled with their handle, without your visibility notice', async () => {
    mockParams.current = { profile: 'p-ana', username: 'ana' };
    const el = await mount();
    expect(mockRpc).toHaveBeenCalledWith('scan_history', { p_profile_id: 'p-ana' });
    expect(mockTitle.current).toBe("@ana's scans");
    expect(el.textContent).not.toContain('Change in Settings');
    expect(rowFor(el, 'Xavi Ortiz')).not.toBeNull();
  });
});
