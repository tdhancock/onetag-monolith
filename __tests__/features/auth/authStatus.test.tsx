/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/auth/authStatus.test.tsx
//
// useAuthStatus (ONE-30): "not known yet" is not "signed out".
//
// useAuthUserId is undefined in both cases. The tag resolution route has to
// tell them apart on a cold start, or a signed-in person's scan is recorded
// as anonymous. The session sync writes null for a launch with no session
// (covered in __tests__/useAppContext.test.tsx, beside the other auth
// events); this suite reads the three states off the query it writes.
//
// Imported from the hooks file itself rather than the barrel, so the suite
// loads no Supabase client and needs no mocks.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStatus, useAuthUserId } from '../../../features/auth/queries';
import type { AuthStatus } from '../../../features/auth/queries';
import { authKeys } from '../../../features/auth/keys';
import { asAuthUserId } from '../../../types';

let root: Root;
let client: QueryClient;
const seen: { status?: AuthStatus; userId?: string } = {};

const Probe = () => {
  seen.status = useAuthStatus();
  seen.userId = useAuthUserId();
  return null;
};

/** Write the session as the sync does, and let observers hear about it. */
const record = async (value: string | null) => {
  await act(async () => {
    client.setQueryData(authKeys.session(), value === null ? null : asAuthUserId(value));
    // TanStack batches observer notifications on a zero timeout.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  client = new QueryClient();
  root = createRoot(document.createElement('div'));
  act(() => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
});

afterEach(() => act(() => root.unmount()));

it('is unknown before anything is recorded', () => {
  expect(seen.status).toBe('unknown');
  expect(seen.userId).toBeUndefined();
});

it('is signed-out once null is recorded — and the user id stays undefined', async () => {
  await record(null);
  expect(seen.status).toBe('signed-out');
  expect(seen.userId).toBeUndefined();
});

it('is signed-in once an account is recorded', async () => {
  await record('auth-x');
  expect(seen.status).toBe('signed-in');
  expect(seen.userId).toBe('auth-x');
});

it('follows sign in and sign out', async () => {
  await record(null);
  await record('auth-x');
  expect(seen.status).toBe('signed-in');
  await record(null);
  expect(seen.status).toBe('signed-out');
});
