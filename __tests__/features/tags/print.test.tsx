/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/tags/print.test.tsx
//
// Print blank tags (ONE-138), app/tags/print.tsx, mounted over the real tags
// feature and a real query client — only the Supabase client, the router,
// the acting profile and the share sheet are faked:
//
//   * it offers a batch of 12 or 24, and makes that many blank Physical
//     Tags for the acting profile in one insert;
//   * the new tags join the profile's cached list at once, as not linked;
//   * a batch of 12 makes one sheet, 24 make two, each previewed with its
//     codes, shared on its own, and all saved to Photos together;
//   * Photos access refused is explained, and Share still works;
//   * a failed batch says so and leaves the choice to retry.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockOpenSettings = jest.fn();
jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return {
    ...shim,
    ScrollView: box,
    Linking: { openSettings: () => mockOpenSettings() },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../../support/expoImageStub'));
// The code itself is drawn and decoded in TagQRCode's own suite (ONE-136).
jest.mock('../../../components/native/TagQRCode', () => {
  const React = require('react');
  const { buildTagUrl } = require('../../../lib/tagLinks');
  return {
    __esModule: true,
    default: (props: { shortCode: string }) => React.createElement('div', { 'data-qr': buildTagUrl(props.shortCode) }),
  };
});

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const mockActing = { profileId: 'p-home' };
jest.mock('../../../features/profiles', () => ({ useCurrentProfile: () => mockActing }));

const mockSaveSheets = jest.fn();
const mockShareSheet = jest.fn();
jest.mock('../../../services/tagSharing', () => ({
  saveTagSheetsToPhotos: (...args: unknown[]) => mockSaveSheets(...args),
  shareTagSheet: (...args: unknown[]) => mockShareSheet(...args),
}));

// ─── The database ───────────────────────────────────────────────────────

/** Valid short codes, as the database would issue them. */
const CODES = Array.from({ length: 24 }, (_, i) => `HOME${'ABCDEFGHJKLMNPQRSTUVWXYZ'[i]}234`);

const mockInserts: unknown[][] = [];
let mockFail = false;

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: () => {
      let rows: Record<string, unknown>[] = [];
      const chain: Record<string, unknown> = {
        insert: (payload: Record<string, unknown>[]) => {
          rows = payload;
          mockInserts.push(payload);
          return chain;
        },
        select: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(
            mockFail
              ? { data: null, error: new Error('offline') }
              : {
                  data: rows.map((row, i) => ({
                    ...row,
                    id: `b${i}`,
                    name: null,
                    note: null,
                    short_code: CODES[i],
                    active: true,
                    created_at: '2026-10-06T12:00:00Z',
                    dest_profile_id: null,
                    dest_product_id: null,
                    dest_project_id: null,
                    dest_post_id: null,
                    host_post_id: null,
                  })),
                  error: null,
                },
          ).then(resolve, reject),
      };
      return chain;
    },
  },
}));

import PrintBlankTagsScreen from '../../../app/tags/print';
import { createBlankTags, MAX_BLANK_TAGS, tagKeys, type OwnedTag } from '../../../features/tags';
import { asProfileId } from '../../../types';
import { buildTagUrl } from '../../../lib/tagLinks';
import { PHOTOS_DENIED_MESSAGE } from '../../../lib/screens/tags';

// ─── Mounting ───────────────────────────────────────────────────────────

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
        <PrintBlankTagsScreen />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const click = async (b: HTMLElement | undefined | null) => {
  await act(async () => (b as HTMLElement).click());
  await settle();
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockActing.profileId = 'p-home';
  mockInserts.length = 0;
  mockFail = false;
  mockToast.mockReset();
  mockRouter.back.mockReset();
  mockSaveSheets.mockReset().mockResolvedValue('saved');
  mockShareSheet.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('choosing a batch', () => {
  it('offers 12 or 24, starting at 12', async () => {
    const el = await mount();
    expect(byLabel(el, '12 tags, One sheet of US Letter')).not.toBeNull();
    expect(byText(el, 'Make 12 tags')).toBeDefined();
    await click(byLabel(el, '24 tags, Two sheets'));
    expect(byText(el, 'Make 24 tags')).toBeDefined();
  });

  it('makes that many blank Physical Tags for the acting profile, in one insert', async () => {
    const el = await mount();
    await click(byText(el, 'Make 12 tags'));
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0]).toHaveLength(12);
    expect(mockInserts[0]!.every((row) =>
      JSON.stringify(row) === JSON.stringify({ owner_profile_id: 'p-home', tag_type: 'physical', format: 'qr' }),
    )).toBe(true);
  });

  it('adds the new tags to the profile\'s list at once, as not linked', async () => {
    client.setQueryData<OwnedTag[]>(tagKeys.mine('p-home'), []);
    const el = await mount();
    await click(byText(el, 'Make 12 tags'));
    const listed = client.getQueryData<OwnedTag[]>(tagKeys.mine('p-home'))!;
    expect(listed).toHaveLength(12);
    expect(listed.every((tag) => !tag.linked && tag.destination === null && tag.tagType === 'physical')).toBe(true);
  });

  it('refuses a batch of none, or of more than two sheets, before writing anything', async () => {
    expect(MAX_BLANK_TAGS).toBe(24);
    await expect(createBlankTags(asProfileId('p-home'), 0)).rejects.toThrow('between 1 and 24');
    await expect(createBlankTags(asProfileId('p-home'), 25)).rejects.toThrow('between 1 and 24');
    expect(mockInserts).toHaveLength(0);
  });

  it('says so when the batch fails, and leaves the choice to try again', async () => {
    mockFail = true;
    const el = await mount();
    await click(byText(el, 'Make 12 tags'));
    expect(mockToast).toHaveBeenCalledWith("Couldn't make the tags. Check your connection and try again.", 'error');
    expect(byText(el, 'Make 12 tags')).toBeDefined();
  });
});

describe('the sheets', () => {
  it('previews one sheet of twelve codes for a batch of 12', async () => {
    const el = await mount();
    await click(byText(el, 'Make 12 tags'));
    expect(el.textContent).toContain('12 blank tags made. Print at 100% scale on US Letter');
    expect(el.textContent).toContain('Sheet 1 of 1');
    expect(Array.from(el.querySelectorAll('[data-qr]')).map((q) => q.getAttribute('data-qr'))).toEqual(
      CODES.slice(0, 12).map(buildTagUrl),
    );
  });

  it('makes two sheets of twelve for a batch of 24, each shared on its own', async () => {
    const el = await mount();
    await click(byLabel(el, '24 tags, Two sheets'));
    await click(byText(el, 'Make 24 tags'));
    expect(el.textContent).toContain('Sheet 1 of 2');
    expect(el.textContent).toContain('Sheet 2 of 2');
    await click(byLabel(el, 'Share sheet 2 of 2'));
    expect(mockShareSheet).toHaveBeenCalledWith(CODES.slice(12, 24));
  });

  it('saves every sheet to Photos together', async () => {
    const el = await mount();
    await click(byLabel(el, '24 tags, Two sheets'));
    await click(byText(el, 'Make 24 tags'));
    await click(byText(el, 'Save sheets to Photos'));
    expect(mockSaveSheets).toHaveBeenCalledWith([CODES.slice(0, 12), CODES.slice(12, 24)]);
    expect(mockToast).toHaveBeenCalledWith('Saved to Photos.', 'success');
  });

  it('explains a refusal of Photos access, with the way to Settings, and Share still works', async () => {
    mockSaveSheets.mockResolvedValue('denied');
    const el = await mount();
    await click(byText(el, 'Make 12 tags'));
    await click(byText(el, 'Save sheet to Photos'));
    expect(el.textContent).toContain(PHOTOS_DENIED_MESSAGE);
    await click(byText(el, 'Open Settings'));
    expect(mockOpenSettings).toHaveBeenCalled();
    await click(byLabel(el, 'Share sheet 1 of 1'));
    expect(mockShareSheet).toHaveBeenCalledWith(CODES.slice(0, 12));
  });

  it('closes with Done, back to the dashboard', async () => {
    const el = await mount();
    expect(byText(el, 'Cancel')).toBeDefined();
    await click(byText(el, 'Make 12 tags'));
    await click(byText(el, 'Done'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
