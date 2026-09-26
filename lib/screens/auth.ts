//
// Pure logic extracted from the sign-in, sign-up and password-reset screens
// (app/(auth)/*) so what makes each form submittable, which field errors
// show, and what the username check says can be tested without mounting
// them. The messages are the ones the screens have always shown.

/**
 * The screens someone without an account may be launched straight into, by
 * their route's first segment: Tag Resolution (ONE-30), and the product and
 * project pages (ONE-40, ONE-41), which a shared link opens and a tag lands
 * on. The launch check in app/_layout.tsx sends everyone else without a
 * session to sign in.
 */
export const PUBLIC_ROUTE_SEGMENTS: readonly string[] = ['t', 'product', 'project'];

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

export interface SignupFields {
  fullName: string;
  username: string;
  /** The username rule's message, from lib/screens/profile. */
  usernameError: string | null;
  usernameStatus: UsernameAvailability;
  email: string;
  password: string;
  confirmPassword: string;
  birthday: string;
}

/**
 * The errors shown under the password fields. Each waits until its field
 * has been left once (`touched`), so nobody is told off mid-word.
 */
export const signupPasswordErrors = (
  fields: Pick<SignupFields, 'password' | 'confirmPassword'>,
  touched: { password?: boolean; confirmPassword?: boolean },
): { password: string | null; confirmPassword: string | null } => ({
  password:
    touched.password && fields.password.length > 0 && fields.password.length < PASSWORD_MIN_LENGTH
      ? PASSWORD_TOO_SHORT
      : null,
  confirmPassword:
    touched.confirmPassword && fields.confirmPassword.length > 0 && fields.confirmPassword !== fields.password
      ? PASSWORDS_DO_NOT_MATCH
      : null,
});

/**
 * Whether Create account can be pressed: every field filled, the username
 * valid and not known to be taken (nor still being checked), and the
 * passwords long enough and matching.
 */
export const signupFormValid = (f: SignupFields): boolean =>
  f.fullName.trim() !== '' &&
  f.username.trim() !== '' &&
  !f.usernameError &&
  f.usernameStatus !== 'taken' &&
  f.usernameStatus !== 'checking' &&
  f.email.trim() !== '' &&
  f.password.length >= PASSWORD_MIN_LENGTH &&
  f.password === f.confirmPassword &&
  f.birthday.trim() !== '';
