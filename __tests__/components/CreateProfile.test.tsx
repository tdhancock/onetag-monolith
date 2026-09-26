/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/CreateProfile.test.tsx
//
// Adding a profile (ONE-26), mounted: only the kinds the account lacks are
// offered; with both held the screen says so and attempts nothing; a handle
// someone holds, or one the database's length and character rules would
// refuse, is rejected before submitting; a handle claimed in the race after
// the check is reported as taken on its field; and a created profile becomes
// the one being acted as, with the app back on the Profile tab.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return { ...shim, ScrollView: box, KeyboardAvoidingView: box, Platform: { OS: 'ios' } };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockBack = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo }),
}));

const mockToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const INDIVIDUAL = { id: 'p-ind', username: 'ana', name: 'Ana', profileType: 'individual' };
const BUSINESS = { id: 'p-biz', username: 'ana_studio', name: 'Ana Studio', profileType: 'business' };

const mockState = {
  profiles: [INDIVIDUAL] as Record<string, unknown>[] | undefined,
  taken: new Set<string>(['someone']),
};
const mockCreate = jest.fn();
jest.mock('../../features/profiles', () => {
  class CreateProfileError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    CreateProfileError,
    useCurrentProfile: () => ({ authUserId: 'auth-x' }),
    useMyProfilesQuery: () => ({ data: mockState.profiles, isPending: !mockState.profiles }),
    useCreateProfile: () => ({ mutateAsync: mockCreate, isPending: false }),
    checkUsernameExists: (username: string) => Promise.resolve(mockState.taken.has(username)),
  };
});

import CreateProfileScreen from '../../app/create-profile';
import { USERNAME_CHECK_DEBOUNCE_MS } from '../../lib/screens/auth';
import { CreateProfileError } from '../../features/profiles';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<CreateProfileScreen />));
  return container;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockState.profiles = [INDIVIDUAL];
  mockState.taken = new Set(['someone']);
  [mockBack, mockDismissTo, mockToast, mockCreate].forEach((m) => m.mockReset());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  jest.useRealTimers();
});

const field = (el: HTMLElement, label: string) => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const createButton = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Create profile') as HTMLButtonElement | undefined;

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Let the debounced availability check run and resolve. */
async function settleCheck() {
  await act(async () => {
    jest.advanceTimersByTime(USERNAME_CHECK_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

async function fillValid(el: HTMLElement, handle = 'ana_works') {
  typeInto(field(el, 'Username'), handle);
  await settleCheck();
  typeInto(field(el, 'Business name'), 'Ana Works');
}

// ─── Which kind ─────────────────────────────────────────────────────────

describe('which profile can be added', () => {
  it('offers only Business to an account that holds its Individual profile', () => {
    const el = mount();
    expect(el.textContent).toContain('New business profile');
    expect(el.textContent).toContain('BUSINESS PROFILE');
    expect(field(el, 'Business name')).not.toBeNull();
    // No choice to make, so none offered.
    expect(el.querySelector('button[aria-label^="Individual profile"]')).toBeNull();
  });

  it('offers only Individual to an account that holds only a Business profile', () => {
    mockState.profiles = [BUSINESS];
    const el = mount();
    expect(el.textContent).toContain('New individual profile');
    expect(field(el, 'Name')).not.toBeNull();
  });

  it('says so, and attempts nothing, when the account already holds both', () => {
    mockState.profiles = [INDIVIDUAL, BUSINESS];
    const el = mount();
    expect(el.textContent).toContain('You have both profiles');
    expect(createButton(el)).toBeUndefined();
    expect(field(el, 'Username')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('waits for the account’s profiles before offering anything', () => {
    mockState.profiles = undefined;
    const el = mount();
    expect(el.querySelector('[data-spinner]')).not.toBeNull();
    expect(createButton(el)).toBeUndefined();
  });
});

// ─── The handle ─────────────────────────────────────────────────────────

describe('the handle', () => {
  it('rejects a handle someone already holds, before submitting', async () => {
    const el = mount();
    typeInto(field(el, 'Username'), 'someone');
    typeInto(field(el, 'Business name'), 'Ana Works');
    await settleCheck();

    expect(el.textContent).toContain('That handle is taken.');
    expect(el.textContent).toContain('Taken');
    expect(createButton(el)!.disabled).toBe(true);
  });

  it.each(['ab', 'a'.repeat(21)])('rejects %j with the database’s length rule', async (handle) => {
    const el = mount();
    typeInto(field(el, 'Username'), handle);
    typeInto(field(el, 'Business name'), 'Ana Works');
    await settleCheck();

    expect(el.textContent).toContain('Username must be between 3 and 20 characters.');
    expect(createButton(el)!.disabled).toBe(true);
  });

  it('lowercases as typed and rejects characters the database would', async () => {
    const el = mount();
    typeInto(field(el, 'Username'), 'Ana Works');
    expect(field(el, 'Username').value).toBe('ana works');
    expect(el.textContent).toContain('Only lowercase letters');
  });

  it('needs a name as well as a free handle', async () => {
    const el = mount();
    typeInto(field(el, 'Username'), 'ana_works');
    await settleCheck();
    expect(el.textContent).toContain('Available');
    expect(createButton(el)!.disabled).toBe(true);

    typeInto(field(el, 'Business name'), 'Ana Works');
    expect(createButton(el)!.disabled).toBe(false);
  });
});

// ─── Creating ───────────────────────────────────────────────────────────

describe('creating the profile', () => {
  it('creates a business profile, acts as it, and returns to the Profile tab', async () => {
    mockCreate.mockResolvedValue({ id: 'p-new', username: 'ana_works' });
    const el = mount();
    await fillValid(el);
    typeInto(field(el, 'Bio'), '  Ceramics.  ');

    await act(async () => { createButton(el)!.click(); });

    expect(mockCreate).toHaveBeenCalledWith({
      profileType: 'business',
      username: 'ana_works',
      fullName: 'Ana Works',
      bio: 'Ceramics.',
    });
    expect(mockToast).toHaveBeenCalledWith("You're now acting as @ana_works.", 'success');
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('sends no bio when none was written', async () => {
    mockCreate.mockResolvedValue({ id: 'p-new', username: 'ana_works' });
    const el = mount();
    await fillValid(el);
    await act(async () => { createButton(el)!.click(); });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ bio: null }));
  });

  it('reports a handle claimed after the check as taken, on its field, not as a raw error', async () => {
    mockCreate.mockRejectedValue(new CreateProfileError('handle-taken'));
    const el = mount();
    await fillValid(el);

    await act(async () => { createButton(el)!.click(); });

    expect(el.textContent).toContain('That handle is taken.');
    expect(createButton(el)!.disabled).toBe(true);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();

    // A different handle clears it.
    mockState.taken = new Set();
    typeInto(field(el, 'Username'), 'ana_works2');
    await settleCheck();
    expect(el.textContent).not.toContain('That handle is taken.');
    expect(createButton(el)!.disabled).toBe(false);
  });

  it('explains a kind the account turned out to hold already', async () => {
    mockCreate.mockRejectedValue(new CreateProfileError('kind-taken'));
    const el = mount();
    await fillValid(el);
    await act(async () => { createButton(el)!.click(); });
    expect(mockToast).toHaveBeenCalledWith('You already have a business profile.', 'error');
  });

  it('keeps the form when anything else fails', async () => {
    mockCreate.mockRejectedValue(new Error('offline'));
    const el = mount();
    await fillValid(el);
    await act(async () => { createButton(el)!.click(); });
    expect(mockToast).toHaveBeenCalledWith('Could not create the profile. Please try again.', 'error');
    expect(field(el, 'Username').value).toBe('ana_works');
    expect(mockDismissTo).not.toHaveBeenCalled();
  });
});
