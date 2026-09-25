/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ProfileSwitcher.test.tsx
//
// The profile switcher (ONE-25): every profile the account owns with its
// kind, the active one marked in words as well as colour, a tap on another
// switching to it and closing, and "Add a Profile" only while a kind is
// missing. Plus the top-bar entry that opens it, and the rules behind both.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => require('../support/reactNativeDom'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });

const mockToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }), { virtual: true });

const INDIVIDUAL = { id: 'p-ind', username: 'ana', name: 'Ana Reyes', profilePicture: null, profileType: 'individual', bio: '' };
const BUSINESS = { id: 'p-biz', username: 'ana_studio', name: 'Ana Studio', profilePicture: null, profileType: 'business', bio: '' };

const mockState = { profiles: [INDIVIDUAL, BUSINESS] as Record<string, unknown>[], activeId: 'p-ind' };
const mockMutate = jest.fn();
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: mockState.activeId, authUserId: 'auth-1' }),
  useMyProfilesQuery: () => ({ data: mockState.profiles }),
  useSetActiveProfile: () => ({ mutate: mockMutate }),
  asProfileId: (id: string) => id,
}), { virtual: true });

import ProfileSwitcher, { ProfileSwitcherButton, SWITCHER_ROW_HEIGHT } from '../../components/native/ProfileSwitcher';
import {
  canAddProfile,
  missingProfileKinds,
  postingAsLabel,
  profileKindLabel,
  switcherRowLabel,
} from '../../lib/screens/profile';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  mockState.profiles = [INDIVIDUAL, BUSINESS];
  mockState.activeId = 'p-ind';
  mockMutate.mockReset();
  mockToast.mockReset();
});

const onClose = jest.fn();
const onAddProfile = jest.fn();
beforeEach(() => {
  onClose.mockReset();
  onAddProfile.mockReset();
});

const open = () => mount(<ProfileSwitcher visible onClose={onClose} onAddProfile={onAddProfile} />);
const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

// ─── The sheet ──────────────────────────────────────────────────────────

describe('ProfileSwitcher', () => {
  it('lists both profiles with their kind, and marks the active one', () => {
    const el = open();
    const individual = button(el, 'Ana Reyes, @ana, Individual profile, active')!;
    const business = button(el, 'Ana Studio, @ana_studio, Business profile')!;

    expect(individual.textContent).toContain('INDIVIDUAL');
    expect(individual.textContent).toContain('@ana');
    expect(business.textContent).toContain('BUSINESS');
    expect(business.textContent).toContain('@ana_studio');
  });

  it('marks the active row in words, not only colour', () => {
    const el = open();
    const individual = button(el, 'Ana Reyes, @ana, Individual profile, active')!;
    const business = button(el, 'Ana Studio, @ana_studio, Business profile')!;
    expect(individual.textContent).toContain('Active');
    expect(business.textContent).not.toContain('Active');
  });

  it('switches to another profile and closes', () => {
    const el = open();
    act(() => button(el, 'Ana Studio, @ana_studio, Business profile')!.click());
    expect(mockMutate).toHaveBeenCalledWith('p-biz', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without switching when the active profile is tapped', () => {
    const el = open();
    act(() => button(el, 'Ana Reyes, @ana, Individual profile, active')!.click());
    expect(mockMutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when a switch fails', () => {
    mockMutate.mockImplementation((_id: string, options: { onError: () => void }) => options.onError());
    const el = open();
    act(() => button(el, 'Ana Studio, @ana_studio, Business profile')!.click());
    expect(mockToast).toHaveBeenCalledWith('Could not switch to @ana_studio.', 'error');
  });

  it('offers no "Add a Profile" once the account holds both kinds', () => {
    const el = open();
    expect(button(el, 'Add a Profile')).toBeNull();
  });

  it('still opens for a single-profile account, with that profile and "Add a Profile"', () => {
    mockState.profiles = [INDIVIDUAL];
    const el = open();
    expect(button(el, 'Ana Reyes, @ana, Individual profile, active')).not.toBeNull();

    act(() => button(el, 'Add a Profile')!.click());
    expect(onClose).toHaveBeenCalled();
    expect(onAddProfile).toHaveBeenCalled();
  });

  it('gives every row at least a 44pt target', () => {
    mockState.profiles = [INDIVIDUAL];
    const el = open();
    expect(SWITCHER_ROW_HEIGHT).toBeGreaterThanOrEqual(44);
    for (const label of ['Ana Reyes, @ana, Individual profile, active', 'Add a Profile']) {
      expect(button(el, label)!.style.minHeight).toBe(`${SWITCHER_ROW_HEIGHT}px`);
    }
  });

  it('renders nothing while closed', () => {
    const el = mount(<ProfileSwitcher visible={false} onClose={onClose} onAddProfile={onAddProfile} />);
    expect(el.querySelector('[data-modal]')).toBeNull();
  });

  it('carries no raw colour', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'components', 'native', 'ProfileSwitcher.tsx'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

// ─── The entry point ────────────────────────────────────────────────────

describe('ProfileSwitcherButton', () => {
  it('shows the acting handle and says it opens the switcher', () => {
    const onPress = jest.fn();
    const el = mount(<ProfileSwitcherButton profile={{ username: 'ana', name: 'Ana Reyes', profilePicture: null }} onPress={onPress} />);
    const entry = button(el, 'Acting as @ana. Switch profile')!;
    expect(entry.textContent).toContain('@ana');
    act(() => entry.click());
    expect(onPress).toHaveBeenCalled();
  });
});

// ─── The rules ──────────────────────────────────────────────────────────

describe('switcher rules', () => {
  it('labels each kind for its mono label', () => {
    expect(profileKindLabel('business')).toBe('BUSINESS');
    expect(profileKindLabel('individual')).toBe('INDIVIDUAL');
    expect(profileKindLabel(undefined)).toBe('INDIVIDUAL');
  });

  it('finds the kinds an account lacks', () => {
    expect(missingProfileKinds([{ profileType: 'individual' }])).toEqual(['business']);
    expect(missingProfileKinds([{ profileType: 'business' }])).toEqual(['individual']);
    expect(missingProfileKinds([{ profileType: 'individual' }, { profileType: 'business' }])).toEqual([]);
    expect(missingProfileKinds([])).toEqual(['individual', 'business']);
  });

  it('offers to add a profile only while a kind is missing', () => {
    expect(canAddProfile([{ profileType: 'individual' }])).toBe(true);
    expect(canAddProfile([{ profileType: 'individual' }, { profileType: 'business' }])).toBe(false);
  });

  it('announces name, handle, kind and whether a row is active', () => {
    expect(switcherRowLabel({ username: 'ana', name: 'Ana', profileType: 'business' }, true)).toBe(
      'Ana, @ana, Business profile, active',
    );
    expect(switcherRowLabel({ username: 'ana', profileType: 'individual' }, false)).toBe('ana, @ana, Individual profile');
  });

  it('says what a post will publish as', () => {
    expect(postingAsLabel({ username: 'ana_studio', profileType: 'business' })).toBe(
      'Posting as @ana_studio, business profile',
    );
  });
});
