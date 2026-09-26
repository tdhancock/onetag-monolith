/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/TagExport.test.tsx
//
// Exporting a tag's QR code, app/tags/[id]/export.tsx (ONE-33), mounted over
// the real tags feature and the real services/tagSharing — only Supabase, the
// router and the native Expo modules are faked:
//
//   * the screen shows the QR large, with the tag's name and destination and
//     the short code beneath in DM Mono;
//   * Save asks for Photos permission on the tap, never on mount, and writes
//     a PNG drawn at print resolution (at least 1024px) to the camera roll;
//   * with permission refused it says why, and Share still works;
//   * the tag's link can be copied.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockOpenSettings = jest.fn(() => Promise.resolve());
jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return {
    ...shim,
    ScrollView: box,
    Platform: { OS: 'ios' },
    Share: { share: jest.fn(() => Promise.resolve()) },
    Linking: { openSettings: () => mockOpenSettings() },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

/** The size each export asked the renderer for. */
const mockExportSizes: unknown[] = [];
const mockSvg = {
  toDataURL: (callback: (base64: string) => void, options?: unknown) => {
    mockExportSizes.push(options);
    callback('UE5HQkFTRTY0');
  },
};
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: { value: string; size: number; getRef?: (svg: unknown) => void }) => {
      React.useEffect(() => props.getRef?.(mockSvg), []);
      return React.createElement('div', { 'data-qr': props.value, 'data-size': props.size });
    },
  };
});

const mockRequestPermissions = jest.fn();
const mockAssetCreate = jest.fn(() => Promise.resolve({}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  Asset: { create: (...args: unknown[]) => mockAssetCreate(...(args as [])) },
}));

const mockWritten: { uri: string; content: string; options: unknown }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    create() {}
    write(content: string, options: unknown) {
      mockWritten.push({ uri: this.uri, content, options });
    }
  },
}));

const mockShareAsync = jest.fn(() => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...args: unknown[]) => mockShareAsync(...(args as [])),
}));

const mockSetString = jest.fn(() => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockSetString(...(args as [])) }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
  Stack: { Screen: () => null },
}));

const mockToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));
jest.mock('../../features/profiles', () => ({ useCurrentProfile: () => ({ profileId: 'p-studio' }) }));

const TAG_ROW = {
  id: 't1',
  owner_profile_id: 'p-studio',
  tag_type: 'physical',
  format: 'qr',
  name: 'Front door',
  note: null,
  short_code: 'ABC23XYZ',
  active: true,
  created_at: '2026-09-20T10:00:00Z',
  dest_profile_id: 'p-studio',
  dest_profile: { id: 'p-studio', username: 'ana_studio', full_name: 'Ana Studio', profile_type: 'business' },
};
jest.mock('../../services/supabase.native', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => Promise.resolve({ data: [TAG_ROW], error: null });
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

import ExportTagScreen from '../../app/tags/[id]/export';
import { buildTagUrl } from '../../lib/tagLinks';
import { PHOTOS_DENIED_MESSAGE } from '../../lib/screens/tags';
import { TAG_QR_EXPORT_PX } from '../../services/tagSharing';
import { type } from '../../theme/tokens';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <ExportTagScreen />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const byText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;

async function tap(button: HTMLButtonElement) {
  act(() => button.click());
  await settle();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockExportSizes.length = 0;
  mockWritten.length = 0;
  [mockRequestPermissions, mockAssetCreate, mockShareAsync, mockSetString, mockToast, mockOpenSettings].forEach((m) =>
    m.mockClear(),
  );
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

describe('the export screen', () => {
  it("shows the QR large, with the tag's name and destination and the short code beneath in DM Mono", async () => {
    const el = await mount();
    expect(el.textContent).toContain('Front door');
    expect(el.textContent).toContain('Ana Studio · @ana_studio');
    const qr = el.querySelector('[data-qr]')!;
    expect(qr.getAttribute('data-qr')).toBe(buildTagUrl('ABC23XYZ'));
    expect(Number(qr.getAttribute('data-size'))).toBeGreaterThanOrEqual(300);
    const code = Array.from(el.querySelectorAll('span')).find((s) => s.textContent === 'ABC23XYZ') as HTMLElement;
    expect(code.style.fontFamily).toBe(type.mono);
  });

  it('does not ask for Photos permission on mount', async () => {
    await mount();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('saves a print-resolution PNG to the camera roll once permission is granted', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    const el = await mount();
    await tap(byText(el, 'Save to Photos'));

    expect(mockRequestPermissions).toHaveBeenCalledWith(true, ['photo']);
    expect(TAG_QR_EXPORT_PX).toBeGreaterThanOrEqual(1024);
    expect(mockExportSizes).toEqual([{ width: TAG_QR_EXPORT_PX, height: TAG_QR_EXPORT_PX }]);
    expect(mockWritten).toEqual([
      { uri: 'file:///cache/onetag-ABC23XYZ.png', content: 'UE5HQkFTRTY0', options: { encoding: 'base64' } },
    ]);
    expect(mockAssetCreate).toHaveBeenCalledWith('file:///cache/onetag-ABC23XYZ.png');
    expect(mockToast).toHaveBeenCalledWith('Saved to Photos.', 'success');
    expect(el.textContent).not.toContain(PHOTOS_DENIED_MESSAGE);
  });

  it('says why when Photos access is refused, and Share still works', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const el = await mount();
    await tap(byText(el, 'Save to Photos'));

    expect(mockAssetCreate).not.toHaveBeenCalled();
    expect(el.textContent).toContain(PHOTOS_DENIED_MESSAGE);
    await tap(byText(el, 'Open Settings'));
    expect(mockOpenSettings).toHaveBeenCalled();

    await tap(byText(el, 'Share'));
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/onetag-ABC23XYZ.png', expect.objectContaining({ mimeType: 'image/png' }));
  });

  it("copies the tag's link", async () => {
    const el = await mount();
    expect(el.querySelector(`[aria-label="Tag link, ${buildTagUrl('ABC23XYZ')}"]`)).not.toBeNull();
    await tap(byText(el, 'Copy link'));
    expect(mockSetString).toHaveBeenCalledWith(buildTagUrl('ABC23XYZ'));
  });
});
