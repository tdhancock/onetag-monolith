/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/AuthScreens.test.tsx
//
// Sign in, sign up and password reset, re-skinned (ONE-76), mounted: the
// white frame with the centred wordmark and labelled fields, the autofill
// hints password managers key on, show/hide and next-field keys, a single
// form-level error instead of an Alert, the live username check ("Taken"
// inside the field, Create account held), field errors under their field,
// and the mail outcome screens.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const ScrollView = (props: { children?: React.ReactNode }) => React.createElement('div', { 'data-scroll': 'true' }, props.children);
  return {
    ...shim,
    ScrollView,
    Platform: { OS: 'ios' },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('div', { 'data-date-picker': 'true' }) };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const auth = {
  signInWithPassword: jest.fn((_a: unknown) => Promise.resolve({ data: {}, error: null as unknown })),
  signUp: jest.fn((_a: unknown) => Promise.resolve({ data: {}, error: null as unknown })),
  resetPasswordForEmail: jest.fn((_e: string, _o: unknown) => Promise.resolve({ error: null as unknown })),
};
jest.mock('../../services/supabase.native', () => ({
  supabase: { auth, rpc: jest.fn(() => Promise.resolve({ data: 'ana@example.com', error: null })) },
}));
jest.mock('../../services/profileBootstrap', () => ({ ensureCurrentUserProfile: () => Promise.resolve(true) }));
const mockUsernameExists = jest.fn((_u: string) => Promise.resolve(false));
jest.mock('../../features/profiles', () => ({ checkUsernameExists: (u: string) => mockUsernameExists(u) }));

import LoginScreen from '../../app/(auth)/login';
import SignupScreen from '../../app/(auth)/signup';
import ForgotPasswordScreen from '../../app/(auth)/forgot-password';
import { Alert } from 'react-native';
import {
  loginFormValid,
  signupFormValid,
  signupPasswordErrors,
  usernameAvailabilityLabel,
  PASSWORD_TOO_SHORT,
  PASSWORDS_DO_NOT_MATCH,
  USERNAME_CHECK_DEBOUNCE_MS,
} from '../../lib/screens/auth';
import { color, type } from '../../theme/tokens';

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
  auth.signInWithPassword.mockImplementation(() => Promise.resolve({ data: {}, error: null }));
  mockUsernameExists.mockImplementation(() => Promise.resolve(false));
  [mockPush, mockReplace, auth.signInWithPassword, auth.signUp, auth.resetPasswordForEmail, mockUsernameExists, Alert.alert as jest.Mock].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const input = (el: HTMLElement, label: string) => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;
const span = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('span')).find(s => s.textContent === text) as HTMLElement | undefined;

/** The props React rendered a DOM node with — for RN-only props like textContentType. */
const propsOf = (node: Element): Record<string, unknown> => {
  const key = Object.keys(node).find(k => k.startsWith('__reactProps$'))!;
  return (node as unknown as Record<string, Record<string, unknown>>)[key]!;
};

const typeInto = (field: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

// ─── 4. Sign in ─────────────────────────────────────────────────────────

describe('Sign in', () => {
  it('is white with the centred mono wordmark, labelled fields and a full-width Sign in', () => {
    const el = mount(<LoginScreen />);
    const wordmark = span(el, 'OneTag')!;
    expect(wordmark.style.fontFamily).toBe(type.mono);
    expect(el.textContent).toContain('Sign in to continue');
    expect(span(el, 'Email or username')).toBeDefined();
    expect(span(el, 'Password')).toBeDefined();
    const signIn = buttonWithText(el, 'Sign in')!;
    expect(signIn.style.width).toBe('100%');
    expect(signIn.style.backgroundColor).toBe(rgb(color.text));
  });

  it('gives password managers the hints they need', () => {
    const el = mount(<LoginScreen />);
    expect(propsOf(input(el, 'Email or username'))).toEqual(
      expect.objectContaining({ textContentType: 'username', autoComplete: 'username', keyboardType: 'email-address' }),
    );
    expect(propsOf(input(el, 'Password'))).toEqual(
      expect.objectContaining({ textContentType: 'password', autoComplete: 'current-password', secureTextEntry: true }),
    );
  });

  it('holds Sign in until both fields have something in them', () => {
    const el = mount(<LoginScreen />);
    expect(buttonWithText(el, 'Sign in')!.disabled).toBe(true);
    typeInto(input(el, 'Email or username'), 'ana@example.com');
    typeInto(input(el, 'Password'), 'secret1');
    expect(buttonWithText(el, 'Sign in')!.disabled).toBe(false);
  });

  it('moves from the identifier to the password on "next"', () => {
    const el = mount(<LoginScreen />);
    act(() => (propsOf(input(el, 'Email or username')).onSubmitEditing as () => void)());
    expect(document.activeElement).toBe(input(el, 'Password'));
  });

  it('shows and hides the password', () => {
    const el = mount(<LoginScreen />);
    act(() => button(el, 'Show password')!.click());
    expect(propsOf(input(el, 'Password')).secureTextEntry).toBe(false);
    act(() => button(el, 'Hide password')!.click());
    expect(propsOf(input(el, 'Password')).secureTextEntry).toBe(true);
  });

  it('shows wrong credentials once, above the button, and never as an Alert', async () => {
    auth.signInWithPassword.mockImplementation(() =>
      Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } }),
    );
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mount(<LoginScreen />);
    typeInto(input(el, 'Email or username'), 'ana@example.com');
    typeInto(input(el, 'Password'), 'wrong-one');
    await act(async () => { buttonWithText(el, 'Sign in')!.click(); });

    const errors = Array.from(el.querySelectorAll('span')).filter(s => s.textContent === 'Invalid login credentials');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.style.color).toBe(rgb(color.heart));
    expect((errors[0]!.parentElement as HTMLElement).style.backgroundColor).toBe(rgb(color.bgPanel));
    const signIn = buttonWithText(el, 'Sign in')!;
    expect(errors[0]!.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('leads to sign up and to the reset screen', () => {
    const el = mount(<LoginScreen />);
    act(() => button(el, 'Create an account')!.click());
    act(() => button(el, 'Forgot password?')!.click());
    expect(mockPush.mock.calls.map(c => c[0])).toEqual(['/(auth)/signup', '/(auth)/forgot-password']);
  });
});

// ─── 5. Sign up ─────────────────────────────────────────────────────────

describe('Sign up', () => {
  const waitForCheck = () =>
    act(async () => { await new Promise(r => setTimeout(r, USERNAME_CHECK_DEBOUNCE_MS + 50)); });

  it('says "Create your account" and labels every field', () => {
    const el = mount(<SignupScreen />);
    expect(el.textContent).toContain('Create your account');
    for (const label of ['Full name', 'Username', 'Email', 'Password', 'Confirm password', 'Birthday']) {
      expect(span(el, label)).toBeDefined();
    }
    expect(propsOf(input(el, 'Password'))).toEqual(
      expect.objectContaining({ textContentType: 'newPassword', autoComplete: 'new-password' }),
    );
    expect(propsOf(input(el, 'Email'))).toEqual(
      expect.objectContaining({ textContentType: 'emailAddress', autoComplete: 'email', keyboardType: 'email-address' }),
    );
  });

  it('shows "Taken" inside the username field and keeps Create account disabled', async () => {
    mockUsernameExists.mockImplementation(() => Promise.resolve(true));
    const el = mount(<SignupScreen />);
    typeInto(input(el, 'Full name'), 'Ana Silva');
    typeInto(input(el, 'Username'), 'ana');
    typeInto(input(el, 'Email'), 'ana@example.com');
    typeInto(input(el, 'Password'), 'secret1');
    typeInto(input(el, 'Confirm password'), 'secret1');
    await waitForCheck();

    const taken = span(el, 'Taken')!;
    expect(taken.style.color).toBe(rgb(color.heart));
    // Inside the field: the status shares the input's wrapper.
    expect(taken.closest('div')!.parentElement!.parentElement!.querySelector('input[aria-label="Username"]')).not.toBeNull();
    expect(buttonWithText(el, 'Create account')!.disabled).toBe(true);
  });

  it('shows "Available" in textMid for a free username', async () => {
    const el = mount(<SignupScreen />);
    typeInto(input(el, 'Username'), 'ana_new');
    await waitForCheck();
    expect(mockUsernameExists).toHaveBeenCalledWith('ana_new');
    expect(span(el, 'Available')!.style.color).toBe(rgb(color.textMid));
  });

  it('puts a short password\'s error under its field once the field is left', () => {
    const el = mount(<SignupScreen />);
    const password = input(el, 'Password');
    typeInto(password, '123');
    expect(el.textContent).not.toContain(PASSWORD_TOO_SHORT);
    act(() => { password.focus(); password.blur(); });
    const error = span(el, PASSWORD_TOO_SHORT)!;
    expect(error.style.color).toBe(rgb(color.heart));
    expect(error.style.fontSize).toBe('13px');
  });

  it('opens the birthday picker from its field, drawn light', () => {
    const el = mount(<SignupScreen />);
    expect(el.querySelector('[data-date-picker="true"]')).toBeNull();
    act(() => button(el, 'Select your birthday')!.click());
    expect(el.querySelector('[data-date-picker="true"]')).not.toBeNull();
    expect(buttonWithText(el, 'Done')).toBeDefined();
  });

  it('opens the picker from the last text field while the birthday is empty', () => {
    const el = mount(<SignupScreen />);
    act(() => (propsOf(input(el, 'Confirm password')).onSubmitEditing as () => void)());
    expect(el.querySelector('[data-date-picker="true"]')).not.toBeNull();
  });
});

// ─── 6. Reset ───────────────────────────────────────────────────────────

describe('Password reset', () => {
  it('says "Reset your password" and holds the button until there is an address', () => {
    const el = mount(<ForgotPasswordScreen />);
    expect(el.textContent).toContain('Reset your password');
    expect(buttonWithText(el, 'Send reset link')!.disabled).toBe(true);
  });

  it('confirms with a mail EmptyState naming the address, and a way back', async () => {
    const el = mount(<ForgotPasswordScreen />);
    typeInto(input(el, 'Email'), 'ana@example.com');
    await act(async () => { buttonWithText(el, 'Send reset link')!.click(); });
    expect(el.textContent).toContain('Check your email');
    expect(el.textContent).toContain('ana@example.com');
    act(() => buttonWithText(el, 'Back to sign in')!.click());
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });
});

// ─── 7. Pure rules ──────────────────────────────────────────────────────

describe('auth rules', () => {
  const filled = {
    fullName: 'Ana Silva',
    username: 'ana',
    usernameError: null,
    usernameStatus: 'available' as const,
    email: 'ana@example.com',
    password: 'secret1',
    confirmPassword: 'secret1',
    birthday: '2000-01-01',
  };

  it('needs both sign-in fields', () => {
    expect(loginFormValid('', 'x')).toBe(false);
    expect(loginFormValid('  ', 'x')).toBe(false);
    expect(loginFormValid('ana', 'x')).toBe(true);
  });

  it('accepts a complete sign-up and refuses each gap', () => {
    expect(signupFormValid(filled)).toBe(true);
    expect(signupFormValid({ ...filled, usernameStatus: 'taken' })).toBe(false);
    expect(signupFormValid({ ...filled, usernameStatus: 'checking' })).toBe(false);
    expect(signupFormValid({ ...filled, usernameStatus: 'unknown' })).toBe(true);
    expect(signupFormValid({ ...filled, usernameError: 'Too short' })).toBe(false);
    expect(signupFormValid({ ...filled, password: '12345', confirmPassword: '12345' })).toBe(false);
    expect(signupFormValid({ ...filled, confirmPassword: 'other' })).toBe(false);
    expect(signupFormValid({ ...filled, birthday: '' })).toBe(false);
  });

  it('shows password errors only once each field is touched', () => {
    const f = { password: '123', confirmPassword: '12' };
    expect(signupPasswordErrors(f, {})).toEqual({ password: null, confirmPassword: null });
    expect(signupPasswordErrors(f, { password: true, confirmPassword: true })).toEqual({
      password: PASSWORD_TOO_SHORT,
      confirmPassword: PASSWORDS_DO_NOT_MATCH,
    });
  });

  it('labels the username check', () => {
    expect(usernameAvailabilityLabel('available')).toBe('Available');
    expect(usernameAvailabilityLabel('taken')).toBe('Taken');
    expect(usernameAvailabilityLabel('checking')).toBeNull();
    expect(usernameAvailabilityLabel('unknown')).toBeNull();
  });
});
