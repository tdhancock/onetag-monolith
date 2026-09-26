/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/SettingsScreens.test.tsx
//
// Settings, blocked accounts, the legal pages and onboarding, re-skinned
// (ONE-75), mounted: grouped white rows under mono headers with no
// Appearance row, the Private account switch in token track colours, the
// blocked list's rows and empty, loading and error states, and the legal
// pages' reading layout. Plus the SettingsRow primitive itself.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const slot = (C: unknown) =>
    C == null ? null : React.isValidElement(C) ? C : React.createElement(C as React.FC);
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListEmptyComponent?: unknown;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
    );
  const ScrollView = (props: { children?: React.ReactNode }) => React.createElement('div', { 'data-scroll': 'true' }, props.children);
  const Switch = (props: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    trackColor?: { true?: string; false?: string };
  }) =>
    React.createElement('input', {
      type: 'checkbox',
      role: 'switch',
      'aria-label': props.accessibilityLabel,
      checked: props.value,
      disabled: props.disabled,
      onChange: (e: { target: { checked: boolean } }) => props.onValueChange(e.target.checked),
      'data-track-on': props.trackColor?.true,
      'data-track-off': props.trackColor?.false,
    });
  return { ...shim, FlatList, ScrollView, Switch };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
// Icons render as a bare <svg>, so a suite can tell a chevron is there.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = () => React.createElement('svg');
  const leaf = () => null;
  return { __esModule: true, default: Svg, Svg, Path: leaf, Circle: leaf, G: leaf, Rect: leaf };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    Stack: { Screen: ({ options }: { options?: { title?: string } }) => React.createElement('h1', null, options?.title) },
  };
});

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockApp = { addToast: jest.fn() };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));

const mockSignOut = jest.fn(() => Promise.resolve());
jest.mock('../../services/supabase.native', () => ({
  supabase: { auth: { signOut: () => mockSignOut() }, functions: { invoke: jest.fn() } },
}));

const mockEnsureProfile = jest.fn(() => Promise.resolve(false));
jest.mock('../../services/profileBootstrap', () => ({ ensureCurrentUserProfile: () => mockEnsureProfile() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

const mockUpdate = jest.fn();
const profileState = { isPrivate: false, status: 'ready' as string };
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({
    profile: { username: 'me', isPrivate: profileState.isPrivate },
    profileId: 'p-me',
    authUserId: 'u-me',
    status: profileState.status,
  }),
  useUpdateProfile: () => ({ mutate: mockUpdate, isPending: false, variables: undefined }),
  profileKeys: { all: ['profiles'] },
}));

const blocks = {
  data: [] as unknown[] | undefined,
  isPending: false,
  isError: false,
  refetch: jest.fn(() => Promise.resolve()),
};
const mockUnblock = jest.fn();
jest.mock('../../features/blocks', () => ({
  useBlocksQuery: () => blocks,
  useBlockToggle: () => ({ toggle: mockUnblock, isPending: false }),
}));

import SettingsScreen from '../../app/settings';
import BlockedUsersScreen from '../../app/blocked-users';
import TermsOfServiceScreen from '../../app/terms';
import PrivacyPolicyScreen from '../../app/privacy-policy';
import OnboardingScreen from '../../app/onboarding';
import SettingsRow, { SettingsSection, SETTINGS_ROW_MIN_HEIGHT } from '../../components/native/ui/SettingsRow';
import { PRIVATE_ACCOUNT_DESCRIPTION, PRIVATE_ACCOUNT_LABEL } from '../../lib/screens/profile';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

beforeEach(() => {
  profileState.isPrivate = false;
  profileState.status = 'ready';
  blocks.data = [];
  blocks.isPending = false;
  blocks.isError = false;
  [mockPush, mockReplace, mockUpdate, mockSignOut, mockUnblock, mockEnsureProfile].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;
const monoLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('span'))
    .filter(s => s.style.textTransform === 'uppercase' && !s.closest('button'))
    .map(s => s.textContent);

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

// ─── 4. Settings ────────────────────────────────────────────────────────

describe('Settings', () => {
  it('groups rows under ACCOUNT, PRIVACY and ABOUT, with no Appearance row', () => {
    const el = mount(<SettingsScreen />);
    expect(monoLabels(el)).toEqual(expect.arrayContaining(['Account', 'Privacy', 'About']));
    expect(el.textContent).not.toContain('Appearance');
    expect(el.textContent).not.toContain('Dark');
  });

  it('draws rows white on the bgSub ground', () => {
    const el = mount(<SettingsScreen />);
    const row = button(el, 'Edit profile')!;
    expect(row.style.backgroundColor).toBe(rgb(color.bg));
    expect(row.style.minHeight).toBe(`${SETTINGS_ROW_MIN_HEIGHT}px`);
  });

  it('navigates from each row', () => {
    const el = mount(<SettingsScreen />);
    act(() => button(el, 'Edit profile')!.click());
    act(() => button(el, 'Blocked accounts')!.click());
    act(() => button(el, 'Privacy policy')!.click());
    act(() => button(el, 'Terms of service')!.click());
    expect(mockPush.mock.calls.map(c => c[0])).toEqual(['/edit-profile', '/blocked-users', '/privacy-policy', '/terms']);
  });

  it('keeps the Private account copy and switches in the token track colours', () => {
    const el = mount(<SettingsScreen />);
    expect(el.textContent).toContain(PRIVATE_ACCOUNT_DESCRIPTION);
    const toggle = el.querySelector(`input[aria-label="${PRIVATE_ACCOUNT_LABEL}"]`) as HTMLInputElement;
    expect(toggle.getAttribute('data-track-on')).toBe(color.text);
    expect(toggle.getAttribute('data-track-off')).toBe(color.borderStrong);
    act(() => toggle.click());
    expect(mockUpdate).toHaveBeenCalledWith({ isPrivate: true }, expect.any(Object));
  });

  it('sets Delete account apart in heart red', () => {
    const el = mount(<SettingsScreen />);
    const row = button(el, 'Delete account')!;
    const title = Array.from(row.querySelectorAll('span')).find(s => s.textContent === 'Delete account')!;
    expect(title.style.color).toBe(rgb(color.heart));
  });

  it('logs out from a full-width outline button', () => {
    const el = mount(<SettingsScreen />);
    act(() => buttonWithText(el, 'Log out')!.click());
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('ends with the version in a centred mono label', () => {
    const el = mount(<SettingsScreen />);
    const version = Array.from(el.querySelectorAll('span')).find(s => s.textContent?.includes('v1.0.0'))!;
    expect(version.style.textAlign).toBe('center');
    expect(version.style.color).toBe(rgb(color.textMuted));
  });
});

// ─── 5. Blocked accounts ────────────────────────────────────────────────

describe('Blocked accounts', () => {
  it('shows the empty state when nobody is blocked', () => {
    const el = mount(<BlockedUsersScreen />);
    expect(el.textContent).toContain("You haven't blocked anyone");
  });

  it('lists each account with an outline Unblock', () => {
    blocks.data = [{ userId: 'u-ana', username: 'ana', name: 'Ana Silva', avatarUrl: null }];
    const el = mount(<BlockedUsersScreen />);
    expect(el.textContent).toContain('Ana Silva');
    expect(el.textContent).toContain('@ana');
    act(() => button(el, 'Unblock ana')!.click());
    expect(mockUnblock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-ana' }));
  });

  it('shows skeleton rows while loading', () => {
    blocks.isPending = true;
    blocks.data = undefined;
    const el = mount(<BlockedUsersScreen />);
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(0);
  });

  it('offers Retry when the list fails to load', () => {
    blocks.isError = true;
    const el = mount(<BlockedUsersScreen />);
    act(() => buttonWithText(el, 'Retry')!.click());
    expect(blocks.refetch).toHaveBeenCalled();
  });
});

// ─── 6. Legal pages ─────────────────────────────────────────────────────

describe('Legal pages', () => {
  it.each([
    ['Terms', TermsOfServiceScreen, 'Terms of Service', '1. Using our Services'],
    ['Privacy', PrivacyPolicyScreen, 'Privacy Policy', '1. Information We Collect'],
  ] as const)('%s: a 22pt title, a last-updated line, bold headings and dark 15/24 body', (_n, Screen, title, heading) => {
    const el = mount(<Screen />);
    const spans = Array.from(el.querySelectorAll('span'));
    const titleEl = spans.find(s => s.textContent === title && s.style.fontSize === '22px')!;
    expect(titleEl).toBeDefined();
    expect(monoLabels(el)).toContain('Last updated April 4, 2026');
    const headingEl = spans.find(s => s.textContent === heading)!;
    expect(headingEl.style.fontSize).toBe('17px');
    const body = spans.find(s => s.textContent === '© 2026 OneTag. All rights reserved.')!;
    expect(body.style.fontSize).toBe('15px');
    // jsdom keeps a unitless line height as written.
    expect(body.style.lineHeight).toBe('24');
    expect(body.style.color).toBe(rgb(color.text));
  });
});

// ─── 7. Onboarding ──────────────────────────────────────────────────────

describe('Onboarding', () => {
  it('shows a single form-level error once creating a profile fails', async () => {
    profileState.status = 'missing';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mount(<OnboardingScreen />);
    await act(async () => { buttonWithText(el, 'Create my profile')!.click(); });
    const error = Array.from(el.querySelectorAll('span')).find(s => s.textContent?.startsWith("That didn't work"))!;
    expect(error.style.color).toBe(rgb(color.heart));
    expect((error.parentElement as HTMLElement).style.backgroundColor).toBe(rgb(color.bgPanel));
    (console.error as jest.Mock).mockRestore();
  });
});

// ─── 8. SettingsRow ─────────────────────────────────────────────────────

describe('SettingsRow', () => {
  const chevronIn = (el: Element) => el.querySelector('svg') !== null;

  it('leads on with a chevron when pressable', () => {
    const el = mount(<SettingsRow title="Edit profile" onPress={jest.fn()} />);
    expect(chevronIn(button(el, 'Edit profile')!)).toBe(true);
  });

  it('shows a control in place of the chevron', () => {
    const el = mount(<SettingsRow title="Private" control={<span data-control="yes" />} />);
    expect(el.querySelector('[data-control="yes"]')).not.toBeNull();
    expect(chevronIn(el)).toBe(false);
  });

  it('drops the chevron on a destructive row', () => {
    const el = mount(<SettingsRow title="Delete account" destructive onPress={jest.fn()} />);
    expect(chevronIn(button(el, 'Delete account')!)).toBe(false);
  });

  it('draws a hairline only when asked, and a section with a hairline-bounded group', () => {
    const el = mount(
      <SettingsSection title="About">
        <SettingsRow title="A" divider />
        <SettingsRow title="B" />
      </SettingsSection>,
    );
    const rows = Array.from(el.querySelectorAll('div')).filter(d => d.style.minHeight === '52px');
    expect(rows[0]!.style.borderBottomWidth).toBe('1px');
    expect(rows[1]!.style.borderBottomWidth).toBe('');
    expect(monoLabels(el)).toEqual(['About']);
  });
});
