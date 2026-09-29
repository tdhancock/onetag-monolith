//
// Pure logic extracted from the sign-in, sign-up and password-reset screens
// (app/(auth)/*) so what makes each form submittable, which field errors
// show, and what the username check says can be tested without mounting
// them. The messages are the ones the screens have always shown.

import { usernameError } from './profile';

/**
 * The screens someone without an account may be launched straight into, by
 * their route's first segment: Tag Resolution (ONE-30), and the product and
 * project pages (ONE-40, ONE-41), which a shared link opens and a tag lands
 * on. A post, which a tag also lands on, asks a stranger to join instead of
 * showing itself. The launch check in app/_layout.tsx sends everyone else
 * without a session to sign in.
 */
export const PUBLIC_ROUTE_SEGMENTS: readonly string[] = ['t', 'product', 'project', 'post'];

/** Whether a route, by its first segment, opens without a session. */
export const opensWithoutSession = (firstSegment: string | undefined): boolean =>
  firstSegment !== undefined && PUBLIC_ROUTE_SEGMENTS.includes(firstSegment);

/** Supabase rejects anything shorter, and the form has always said so. */
export const PASSWORD_MIN_LENGTH = 6;
/** How long typing must pause before the username is looked up. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;

export const PASSWORD_TOO_SHORT = 'Password must be at least 6 characters long.' as const;
export const PASSWORDS_DO_NOT_MATCH = 'Passwords do not match.' as const;

/**
 * Where the live username check stands. `unknown` is a lookup that failed:
 * it does not block the form, because the submit checks again anyway.
 */
export type UsernameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

/** The status shown inside the username field, or null for none. */
export const usernameAvailabilityLabel = (status: UsernameAvailability): 'Available' | 'Taken' | null => {
  if (status === 'available') return 'Available';
  if (status === 'taken') return 'Taken';
  return null;
};

/** Sign in needs something in both fields. */
export const loginFormValid = (identifier: string, password: string): boolean =>
  identifier.trim() !== '' && password !== '';

/** Reset needs an address to send to. */
export const resetFormValid = (email: string): boolean => email.trim() !== '';

export interface SignupDraft {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  /** YYYY-MM-DD, from the picker. */
  birthday: string;
}

export const EMPTY_SIGNUP_DRAFT: SignupDraft = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  birthday: '',
};

export const ENTER_FULL_NAME = 'Enter your name.' as const;
export const CHOOSE_USERNAME = 'Choose a username.' as const;
export const ENTER_EMAIL = 'Enter your email.' as const;
export const CHOOSE_BIRTHDAY = 'Choose your birthday.' as const;

/**
 * What is wrong with a sign-up, field by field: every field is needed, the
 * username follows Edit profile's rule, and the passwords are long enough and
 * match. Whether the username is free is the live check's to say.
 */
export const signupErrors = (d: SignupDraft) => ({
  fullName: d.fullName.trim() === '' ? ENTER_FULL_NAME : null,
  username: d.username === '' ? CHOOSE_USERNAME : usernameError(d.username),
  email: d.email.trim() === '' ? ENTER_EMAIL : null,
  password: d.password.length < PASSWORD_MIN_LENGTH ? PASSWORD_TOO_SHORT : null,
  confirmPassword: d.confirmPassword !== d.password ? PASSWORDS_DO_NOT_MATCH : null,
  birthday: d.birthday.trim() === '' ? CHOOSE_BIRTHDAY : null,
});

/**
 * Where the live username check stands for the handle in the field. Nothing
 * is said of an empty handle, or one the rule refuses; otherwise it is being
 * checked, taken, or free once the server has said so. A lookup that failed
 * says nothing, and blocks nothing: saving checks again.
 */
export const usernameStatusFrom = (s: {
  username: string;
  checking: boolean;
  taken: boolean;
  confirmedFree: boolean;
}): UsernameAvailability => {
  if (!s.username || usernameError(s.username)) return 'idle';
  if (s.checking) return 'checking';
  if (s.taken) return 'taken';
  return s.confirmedFree ? 'available' : 'idle';
};
