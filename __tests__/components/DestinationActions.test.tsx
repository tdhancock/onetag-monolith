/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/DestinationActions.test.tsx
//
// Save and Share on a Product or Project page (ONE-40, ONE-41), mounted over
// the real saves feature and a real query client — only the Supabase client,
// the router, the acting profile and the share sheet are faked:
//
//   * Save writes a save of this target as the active profile, and reads
//     Saved once it is saved;
//   * someone signed out is offered a way in, not a Save that can only fail;
//   * Share passes the page's name and route on, signed in or not.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => require('../support/reactNativeDom'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockActing: { profileId: string | undefined; status: string } = { profileId: 'p-me', status: 'ready' };
jest.mock('../../features/profiles', () => ({ useCurrentProfile: () => mockActing }));

const mockShareDestination = jest.fn((_d: unknown) => Promise.resolve());
jest.mock('../../services/destinationSharing', () => ({
  shareDestination: (d: unknown) => mockShareDestination(d),
}));

const mockSaves: Record<string, unknown>[] = [];
const mockInserts = jest.fn();
jest.mock('../../services/supabase.native', () => ({
  supabase: {
    from: () => {
      const op: { kind: string; payload?: Record<string, unknown> } = { kind: 'select' };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        insert: (payload: Record<string, unknown>) => {
          op.kind = 'insert';
          op.payload = payload;
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (op.kind === 'insert') {
            mockInserts(op.payload);
            mockSaves.push({ id: `s-${mockSaves.length}`, saved_at: '2026-09-26T00:00:00Z', ...op.payload });
            return Promise.resolve({ error: null }).then(resolve);
          }
          return Promise.resolve({ data: [...mockSaves], error: null }).then(resolve);
        },
      };
      return chain;
    },
  },
}));

import DestinationActions from '../../components/native/DestinationActions';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function settle(rounds = 6) {
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
        <DestinationActions target={{ kind: 'product', id: 'pd-1' }} title="Oak door" route="/product/pd-1" />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}

const byText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockActing.profileId = 'p-me';
  mockActing.status = 'ready';
  mockSaves.length = 0;
  [mockPush, mockInserts, mockShareDestination].forEach((m) => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

describe('Save', () => {
  it('saves this product as the active profile, and then reads Saved', async () => {
    const el = await mount();
    act(() => byText(el, 'Save')!.click());
    await settle();

    expect(mockInserts).toHaveBeenCalledWith({ profile_id: 'p-me', saved_product_id: 'pd-1' });
    expect(byText(el, 'Saved')).toBeTruthy();
    expect(byText(el, 'Saved')!.getAttribute('aria-label')).toBe('Saved. Remove Oak door from your saves');
  });

  it('reads Saved for something the profile already saved', async () => {
    mockSaves.push({ id: 's-0', profile_id: 'p-me', saved_product_id: 'pd-1', saved_at: '2026-09-25T00:00:00Z' });
    const el = await mount();
    expect(byText(el, 'Saved')).toBeTruthy();
  });

  it('offers a way in to someone signed out, and writes nothing', async () => {
    mockActing.profileId = undefined;
    mockActing.status = 'signed-out';
    const el = await mount();

    expect(byText(el, 'Save')).toBeUndefined();
    act(() => byText(el, 'Sign up to save')!.click());
    expect(mockPush).toHaveBeenCalledWith('/(auth)/signup');
    expect(mockInserts).not.toHaveBeenCalled();
  });
});

describe('Share', () => {
  it("passes the page's name and route on", async () => {
    const el = await mount();
    act(() => byText(el, 'Share')!.click());
    expect(mockShareDestination).toHaveBeenCalledWith({ title: 'Oak door', route: '/product/pd-1' });
  });

  it('works signed out too', async () => {
    mockActing.profileId = undefined;
    mockActing.status = 'signed-out';
    const el = await mount();
    act(() => byText(el, 'Share')!.click());
    expect(mockShareDestination).toHaveBeenCalledTimes(1);
  });
});
