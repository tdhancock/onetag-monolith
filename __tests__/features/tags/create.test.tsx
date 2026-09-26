/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/tags/create.test.tsx
//
// The tag creation flow, app/tags/create.tsx (ONE-32), mounted over the real
// tags feature and a real query client — only the Supabase client, the
// router, the account's profiles and the share sheet are faked:
//
//   * the destination picker lists only the account's own profiles;
//   * a Physical Tag is inserted with format qr and no short code, and ends
//     on its QR and the way to export it; a Digital Tag ends on its link,
//     which is exactly buildTagUrl(shortCode), with copy and share;
//   * going back a step keeps what was entered;
//   * while the insert is in flight no short code is shown, and a failed
//     insert is retried without re-entering anything;
//   * a replacement starts pre-filled, at naming it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return { ...shim, ScrollView: box, KeyboardAvoidingView: box, Platform: { OS: 'ios' } };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../../support/expoImageStub'));
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: { value: string }) => React.createElement('div', { 'data-qr': props.value }),
  };
});

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const ANA = { id: 'p-ana', username: 'ana', name: 'Ana Reyes', profileType: 'individual', profilePicture: null };
const STUDIO = { id: 'p-studio', username: 'ana_studio', name: 'Ana Studio', profileType: 'business', profilePicture: null };
jest.mock('../../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: 'p-studio', authUserId: 'auth-1' }),
  useMyProfilesQuery: () => ({ data: [ANA, STUDIO] }),
}));

const mockCopy = jest.fn(() => Promise.resolve());
const mockShare = jest.fn(() => Promise.resolve());
jest.mock('../../../services/tagSharing', () => ({
  copyTagLink: (...args: unknown[]) => mockCopy(...(args as [])),
  shareTagLink: (...args: unknown[]) => mockShare(...(args as [])),
}));

const mockInsert = jest.fn();
const mockSingle = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        mockInsert(row);
        return { select: () => ({ single: () => mockSingle() }) };
      },
    }),
  },
}));

import CreateTagScreen from '../../../app/tags/create';
import { buildTagUrl } from '../../../lib/tagLinks';

const CODE = 'ABC23XYZ';

const rowFor = (inserted: Record<string, unknown>) => ({
  id: 't-new',
  owner_profile_id: inserted.owner_profile_id,
  tag_type: inserted.tag_type,
  format: inserted.format,
  name: inserted.name,
  note: inserted.note,
  short_code: CODE,
  active: true,
  created_at: '2026-09-25T12:00:00Z',
  dest_profile_id: inserted.dest_profile_id,
  dest_profile: { id: 'p-studio', username: 'ana_studio', full_name: 'Ana Studio', profile_type: 'business' },
});

/** The insert answers when the test says so. */
function deferInsert() {
  let settle: { resolve: () => void; reject: () => void } = { resolve: () => undefined, reject: () => undefined };
  mockSingle.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = {
          resolve: () => resolve({ data: rowFor(mockInsert.mock.calls.at(-1)![0]), error: null }),
          reject: () => resolve({ data: null, error: new Error('network down') }),
        };
      }),
  );
  return () => settle;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <CreateTagScreen />
      </QueryClientProvider>,
    ),
  );
  return container;
}

async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const containing = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent?.includes(text));
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const field = (el: HTMLElement, label: string) => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const click = (b: HTMLButtonElement | undefined | null) => act(() => b!.click());

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Choose a type and the business profile, name it, and reach confirm. */
function fillTo(el: HTMLElement, kind: 'Physical Tag' | 'Digital Tag', name = 'Front door') {
  click(containing(el, kind));
  click(byText(el, 'Continue'));
  click(byLabel(el, 'Ana Studio'));
  click(byText(el, 'Continue'));
  typeInto(field(el, 'Name'), name);
  click(byText(el, 'Continue'));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockParams.current = {};
  [mockRouter.back, mockRouter.replace, mockRouter.push, mockToast, mockCopy, mockShare, mockInsert, mockSingle].forEach(
    (m) => m.mockClear(),
  );
  mockSingle.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

describe('the steps', () => {
  it('starts at choosing a type, shows progress, and will not continue without one', () => {
    const el = mount();
    expect(el.textContent).toContain('What kind of tag?');
    expect(el.textContent).toContain('Step 1 of 4');
    expect(byText(el, 'Continue')!.disabled).toBe(true);
    // Embedded Tags are made in the composer, not here.
    expect(containing(el, 'Embedded')).toBeUndefined();
  });

  it("lists only the account's own profiles as destinations, and no posts", () => {
    const el = mount();
    click(containing(el, 'Physical Tag'));
    click(byText(el, 'Continue'));
    expect(el.textContent).toContain('Where does it go?');
    expect(el.textContent).toContain('Your profiles');
    const choices = buttons(el).filter((b) => b.getAttribute('aria-label')?.startsWith('Ana'));
    expect(choices.map((b) => b.getAttribute('aria-label'))).toEqual(['Ana Reyes', 'Ana Studio']);
    expect(el.textContent).not.toMatch(/post/i);
    expect(byText(el, 'Continue')!.disabled).toBe(true);
    click(byLabel(el, 'Ana Studio'));
    expect(byLabel(el, 'Ana Studio, selected')).not.toBeNull();
    expect(byText(el, 'Continue')!.disabled).toBe(false);
  });

  it('keeps what was entered when going back and forward again', () => {
    const el = mount();
    click(containing(el, 'Physical Tag'));
    click(byText(el, 'Continue'));
    click(byLabel(el, 'Ana Studio'));
    click(byText(el, 'Continue'));
    typeInto(field(el, 'Name'), 'Front door');
    typeInto(field(el, 'Note'), 'By the bell');

    click(byText(el, 'Back'));
    expect(byLabel(el, 'Ana Studio, selected')).not.toBeNull();
    click(byText(el, 'Back'));
    expect(el.textContent).toContain('Step 1 of 4');

    click(byText(el, 'Continue'));
    click(byText(el, 'Continue'));
    expect(field(el, 'Name').value).toBe('Front door');
    expect(field(el, 'Note').value).toBe('By the bell');
  });

  it('confirms everything before creating', () => {
    const el = mount();
    fillTo(el, 'Physical Tag');
    expect(el.textContent).toContain('Check and create');
    expect(el.textContent).toContain('Physical Tag');
    expect(el.textContent).toContain('Ana Studio');
    expect(el.textContent).toContain('Front door');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('creating a Physical Tag', () => {
  it('inserts with format qr and a database-issued code, then shows the QR and the way to export it', async () => {
    const el = mount();
    fillTo(el, 'Physical Tag');
    const answer = deferInsert();
    click(byText(el, 'Create tag'));
    await settle();

    expect(mockInsert).toHaveBeenCalledWith({
      owner_profile_id: 'p-studio',
      tag_type: 'physical',
      format: 'qr',
      name: 'Front door',
      note: null,
      dest_profile_id: 'p-studio',
    });
    // Pending: said so, and no code until the row returns.
    expect(el.textContent).toContain('Creating your tag');
    expect(el.textContent).not.toContain(CODE);
    expect(el.querySelector('[data-qr]')).toBeNull();

    await act(async () => answer().resolve());
    await settle();

    expect(el.textContent).toContain('Tag created');
    expect(el.querySelector('[data-qr]')!.getAttribute('data-qr')).toBe(buildTagUrl(CODE));
    click(byText(el, 'Export QR code'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/tags/t-new/export');
  });
});

describe('creating a Digital Tag', () => {
  it('inserts with no format, then shows the link with copy and share', async () => {
    const el = mount();
    fillTo(el, 'Digital Tag', '');
    const answer = deferInsert();
    click(byText(el, 'Create tag'));
    await settle();
    expect(mockInsert.mock.calls[0]![0]).toMatchObject({ tag_type: 'digital', format: null, name: null });

    await act(async () => answer().resolve());
    await settle();

    expect(el.querySelector('[data-qr]')).toBeNull();
    const link = el.querySelector(`[aria-label="Tag link, ${buildTagUrl(CODE)}"]`);
    expect(link!.textContent).toBe(buildTagUrl(CODE));

    click(byText(el, 'Copy link'));
    click(byText(el, 'Share link'));
    expect(mockCopy).toHaveBeenCalledWith(CODE);
    expect(mockShare).toHaveBeenCalledWith(CODE);
  });
});

describe('a failed insert', () => {
  it('says so, and retries with everything still entered', async () => {
    const el = mount();
    fillTo(el, 'Physical Tag');
    const first = deferInsert();
    click(byText(el, 'Create tag'));
    await settle();
    await act(async () => first().reject());
    await settle();

    expect(el.textContent).toContain("Couldn't create the tag. Nothing you entered was lost");
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't create the tag"), 'error');
    expect(el.textContent).not.toContain('Tag created');

    const second = deferInsert();
    click(byText(el, 'Try again'));
    await settle();
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls[1]![0]).toEqual(mockInsert.mock.calls[0]![0]);
    await act(async () => second().resolve());
    await settle();
    expect(el.textContent).toContain('Tag created');
  });
});

describe('a replacement', () => {
  it('starts at naming it, with the type and destination already chosen', () => {
    mockParams.current = { type: 'physical', destination: 'p-studio' };
    const el = mount();
    expect(el.textContent).toContain('Name it');
    expect(el.textContent).toContain('Step 3 of 4');
    click(byText(el, 'Back'));
    expect(byLabel(el, 'Ana Studio, selected')).not.toBeNull();
  });

  it("ignores a destination the account doesn't own", () => {
    mockParams.current = { type: 'physical', destination: 'p-someone-else' };
    const el = mount();
    expect(el.textContent).toContain('Where does it go?');
    expect(buttons(el).some((b) => b.getAttribute('aria-label')?.endsWith(', selected'))).toBe(false);
  });
});

describe('leaving', () => {
  it('cancels from the header', () => {
    const el = mount();
    click(byText(el, 'Cancel'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
