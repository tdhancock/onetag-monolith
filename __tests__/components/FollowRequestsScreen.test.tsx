/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/FollowRequestsScreen.test.tsx
//
// Follow requests (ONE-63), mounted: the requests waiting on the active
// profile, newest first as the query returns them, each with Approve and
// Decline; a row opens the requester's profile; and the empty, loading and
// error states.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const FlatList = (props: {
    data: { id: string }[];
    renderItem: (info: { item: unknown }) => React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      props.data.length === 0
        ? props.ListEmptyComponent
        : props.data.map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item }))),
    );
  return { ...shim, FlatList, RefreshControl: () => null };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const request = (id: string, username: string) => ({
  id,
  createdAt: '2026-09-27T12:00:00Z',
  requester: { id: `p-${username}`, username, name: username.toUpperCase(), avatar: null, isVerified: false },
});

const state = {
  query: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(() => Promise.resolve()),
  },
};
const mockApprove = jest.fn();
const mockDecline = jest.fn();
const mockAddToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockAddToast }) }));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: 'p-me' }),
  useFollowRequestsQuery: () => state.query,
  useApproveFollowRequest: () => ({ mutate: mockApprove }),
  useDeclineFollowRequest: () => ({ mutate: mockDecline }),
}));

import FollowRequestsScreen from '../../app/follow-requests';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<FollowRequestsScreen />));
  return container;
}

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

beforeEach(() => {
  state.query.data = [];
  state.query.isPending = false;
  state.query.isError = false;
  [mockPush, mockApprove, mockDecline, mockAddToast].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ─── 4. Tests ───────────────────────────────────────────────────────────

describe('Follow requests', () => {
  it('lists each requester in the order the query gives, newest first', () => {
    state.query.data = [request('fr-2', 'ben'), request('fr-1', 'ana')];
    const el = mount();
    const text = el.textContent!;
    expect(text).toContain('@ben');
    expect(text).toContain('@ana');
    expect(text.indexOf('@ben')).toBeLessThan(text.indexOf('@ana'));
  });

  it('approves a request by its id', () => {
    state.query.data = [request('fr-1', 'ana')];
    const el = mount();
    act(() => button(el, 'Approve @ana')!.click());
    expect(mockApprove).toHaveBeenCalledWith('fr-1', expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('declines a request by its id', () => {
    state.query.data = [request('fr-1', 'ana')];
    const el = mount();
    act(() => button(el, 'Decline @ana')!.click());
    expect(mockDecline).toHaveBeenCalledWith('fr-1', expect.anything());
  });

  it('says so when an answer fails', () => {
    state.query.data = [request('fr-1', 'ana')];
    const el = mount();
    act(() => button(el, 'Approve @ana')!.click());
    const { onError } = mockApprove.mock.calls[0][1] as { onError: () => void };
    act(() => onError());
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('@ana'), 'error');
  });

  it('opens the requester\'s profile from the row', () => {
    state.query.data = [request('fr-1', 'ana')];
    const el = mount();
    act(() => button(el, 'View ana\'s profile')!.click());
    expect(mockPush).toHaveBeenCalledWith('/user/ana');
  });

  it('says there are none when the list is empty', () => {
    const el = mount();
    expect(el.textContent).toContain('No follow requests');
  });

  it('offers Retry when the list fails to load', () => {
    state.query.data = undefined;
    state.query.isError = true;
    const el = mount();
    expect(el.textContent).toContain("Couldn't load follow requests");
  });
});
