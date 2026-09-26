/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/tags/dashboard.test.tsx
//
// The Tags dashboard and a tag's detail screen (ONE-34), mounted over the
// real tags feature and a real query client — only the Supabase client, the
// router and the acting profile are faked:
//
//   * the dashboard lists only the active profile's tags, newest first, and a
//     profile switch shows the other profile's;
//   * scan counts come from tag_scan_counts, and scan rows are never read;
//   * an inactive tag is marked unmistakably, and the filters (Embedded
//     included) narrow the list;
//   * the activation switch answers at once and reverts if the server refuses;
//   * with no tags, the empty state explains Tags and routes to creation;
//   * on the detail screen the short code and destination are shown but not
//     editable, deleting says what it means before anything is removed, and a
//     Physical Tag can be replaced with its destination carried over.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const slot = (node: unknown) =>
    typeof node === 'function' ? React.createElement(node as React.ComponentType) : (node as React.ReactNode) ?? null;
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListHeaderComponent?: unknown;
    ListEmptyComponent?: unknown;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      slot(props.ListHeaderComponent),
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
    );
  const Switch = (props: { value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel?: string }) =>
    React.createElement('button', {
      role: 'switch',
      'aria-checked': props.value,
      'aria-label': props.accessibilityLabel,
      onClick: () => props.onValueChange(!props.value),
    });
  return {
    ...shim,
    FlatList,
    Switch,
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
  };
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
  // The header's right slot renders inline, so its + is reachable.
  Stack: {
    Screen: (p: { options?: { headerRight?: () => unknown; title?: string } }) =>
      p.options?.headerRight ? p.options.headerRight() : null,
  },
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const mockActing = { profileId: 'p-studio' };
jest.mock('../../../features/profiles', () => ({ useCurrentProfile: () => mockActing }));

jest.mock('../../../services/tagSharing', () => ({
  copyTagLink: jest.fn(() => Promise.resolve()),
  shareTagLink: jest.fn(() => Promise.resolve()),
}));

// ─── The database ───────────────────────────────────────────────────────

const STUDIO_DEST = { id: 'p-studio', username: 'ana_studio', full_name: 'Ana Studio', profile_type: 'business' };
const row = (overrides: Record<string, unknown>) => ({
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
  dest_profile: STUDIO_DEST,
  ...overrides,
});

const mockDb = {
  tags: {} as Record<string, Record<string, unknown>[]>,
  counts: {} as Record<string, Record<string, unknown>[]>,
};
/** Every table read or written, so a read of `scans` would show. */
const mockTables: string[] = [];
const mockOwnerFilters: unknown[] = [];
const mockWrites = jest.fn();
/** What the next write answers; a test can hold it open. */
let mockWriteResult: () => Promise<{ data: unknown; error: unknown }>;

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: (table: string) => {
      mockTables.push(table);
      const op: { kind: string; payload?: unknown; filters: [string, unknown][] } = { kind: 'select', filters: [] };
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          op.filters.push([column, value]);
          if (column === 'owner_profile_id') mockOwnerFilters.push(value);
          return chain;
        },
        update: (payload: unknown) => {
          op.kind = 'update';
          op.payload = payload;
          return chain;
        },
        delete: () => {
          op.kind = 'delete';
          return chain;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          if (op.kind === 'select') {
            const owner = op.filters.find(([c]) => c === 'owner_profile_id')?.[1] as string;
            return Promise.resolve({ data: mockDb.tags[owner] ?? [], error: null }).then(resolve, reject);
          }
          mockWrites(op.kind, op.payload, op.filters);
          // A write the server accepts lands in the database the next read sees.
          return mockWriteResult()
            .then((result) => {
              if (!result.error) {
                const id = op.filters.find(([c]) => c === 'id')?.[1];
                for (const owner of Object.keys(mockDb.tags)) {
                  mockDb.tags[owner] =
                    op.kind === 'delete'
                      ? mockDb.tags[owner]!.filter((r) => r.id !== id)
                      : mockDb.tags[owner]!.map((r) => (r.id === id ? { ...r, ...(op.payload as object) } : r));
                }
              }
              return result;
            })
            .then(resolve, reject);
        },
      };
      return chain;
    },
    rpc: (name: string, args: { p_owner_profile_id: string }) =>
      Promise.resolve({ data: name === 'tag_scan_counts' ? mockDb.counts[args.p_owner_profile_id] ?? [] : null, error: null }),
  },
}));

import TagsDashboardScreen from '../../../app/tags/index';
import TagDetailScreen from '../../../app/tags/[id]';
import { Alert } from 'react-native';
import { buildTagUrl } from '../../../lib/tagLinks';
import { tagKeys } from '../../../features/tags';

// ─── Mounting ───────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

const tree = (screen: React.ReactElement) => <QueryClientProvider client={client}>{screen}</QueryClientProvider>;

async function mount(screen: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(tree(screen)));
  await settle();
  return container;
}

async function rerender(screen: React.ReactElement) {
  act(() => root!.render(tree(screen)));
  await settle();
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const rowTitles = (el: HTMLElement) =>
  buttons(el)
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((label) => / tag, (Active|Inactive)$/.test(label))
    .map((label) => label.split(',')[0]);
const click = (b: HTMLElement | undefined | null) => act(() => (b as HTMLElement).click());

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockActing.profileId = 'p-studio';
  mockParams.current = {};
  mockDb.tags = {
    'p-studio': [
      row({ id: 't-old', name: 'Old sign', short_code: 'OLDSGN23', created_at: '2026-09-01T00:00:00Z' }),
      row({ id: 't1', name: 'Front door', created_at: '2026-09-20T10:00:00Z' }),
      row({
        id: 't-link',
        tag_type: 'digital',
        format: null,
        name: 'Bio link',
        short_code: 'LNK23456',
        created_at: '2026-09-24T00:00:00Z',
      }),
      row({ id: 't-paused', name: 'Van', short_code: 'VAN23456', active: false, created_at: '2026-09-10T00:00:00Z' }),
    ],
    'p-ana': [row({ id: 't-ana', owner_profile_id: 'p-ana', name: 'Ana card', short_code: 'ANA23456' })],
  };
  mockDb.counts = { 'p-studio': [{ tag_id: 't1', scan_count: 3, last_scanned_at: new Date().toISOString() }] };
  mockTables.length = 0;
  mockOwnerFilters.length = 0;
  mockWrites.mockReset();
  mockWriteResult = () => Promise.resolve({ data: [{ id: 'x' }], error: null });
  [mockRouter.back, mockRouter.replace, mockRouter.push, mockToast].forEach((m) => m.mockClear());
  (Alert.alert as jest.Mock).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

// ─── The dashboard ──────────────────────────────────────────────────────

describe('the dashboard', () => {
  it("lists only the active profile's tags, newest first", async () => {
    const el = await mount(<TagsDashboardScreen />);
    expect(mockOwnerFilters).toEqual(['p-studio']);
    expect(rowTitles(el)).toEqual(['Bio link', 'Front door', 'Van', 'Old sign']);
    expect(el.textContent).not.toContain('Ana card');
  });

  it("shows the other profile's tags after a profile switch", async () => {
    const el = await mount(<TagsDashboardScreen />);
    mockActing.profileId = 'p-ana';
    await rerender(<TagsDashboardScreen />);
    expect(rowTitles(el)).toEqual(['Ana card']);
  });

  it('takes scan counts from tag_scan_counts and never reads scan rows', async () => {
    const el = await mount(<TagsDashboardScreen />);
    expect(el.textContent).toContain('3 scans · last just now');
    expect(el.textContent).toContain('No scans yet');
    expect(mockTables.every((table) => table === 'tags')).toBe(true);
  });

  it("shows each row's type, code and destination", async () => {
    const el = await mount(<TagsDashboardScreen />);
    expect(el.textContent).toContain('Physical · ABC23XYZ');
    expect(el.textContent).toContain('Digital · LNK23456');
    expect(el.textContent).toContain('Ana Studio · @ana_studio');
  });

  it('marks an inactive tag with a solid badge, not a tint', async () => {
    const el = await mount(<TagsDashboardScreen />);
    const badges = el.querySelectorAll('[aria-label="Inactive"]');
    expect(badges).toHaveLength(1);
    expect((badges[0] as HTMLElement).textContent).toBe('Inactive');
    expect((badges[0] as HTMLElement).style.backgroundColor).not.toBe('');
  });

  it('filters by type, Embedded included, and by state', async () => {
    const el = await mount(<TagsDashboardScreen />);
    expect(byLabel(el, 'Type: Embedded')).not.toBeNull();

    click(byLabel(el, 'Type: Digital'));
    expect(rowTitles(el)).toEqual(['Bio link']);

    click(byLabel(el, 'Type: All'));
    click(byLabel(el, 'State: Inactive'));
    expect(rowTitles(el)).toEqual(['Van']);

    click(byLabel(el, 'Type: Embedded'));
    expect(rowTitles(el)).toEqual([]);
    expect(el.textContent).toContain('No tags match');
    click(byText(el, 'Show all tags'));
    expect(rowTitles(el)).toHaveLength(4);
  });

  it('opens a tag, and the create flow from the header', async () => {
    const el = await mount(<TagsDashboardScreen />);
    click(byLabel(el, 'Front door, Physical tag, Active'));
    expect(mockRouter.push).toHaveBeenCalledWith('/tags/t1');
    click(byLabel(el, 'Create a tag'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tags/create', params: {} });
  });

  it('explains Tags and routes to creation when there are none', async () => {
    mockDb.tags['p-studio'] = [];
    const el = await mount(<TagsDashboardScreen />);
    expect(el.textContent).toContain('No tags yet');
    expect(el.textContent).toContain('A Tag is a portal to one place on OneTag');
    click(byText(el, 'Create a tag'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tags/create', params: {} });
  });
});

describe('the activation switch', () => {
  it('updates the row at once, and writes active', async () => {
    let answer: (result: { data: unknown; error: unknown }) => void = () => undefined;
    mockWriteResult = () => new Promise((resolve) => (answer = resolve));
    const el = await mount(<TagsDashboardScreen />);

    click(byLabel(el, 'Front door: active'));
    await settle(2);
    // Before the server has answered.
    expect(byLabel(el, 'Front door, Physical tag, Inactive')).not.toBeNull();
    expect(mockWrites).toHaveBeenCalledWith('update', { active: false }, [['id', 't1']]);

    await act(async () => answer({ data: [{ id: 't1' }], error: null }));
    await settle();
    expect(byLabel(el, 'Front door, Physical tag, Inactive')).not.toBeNull();
  });

  it('reverts if the server refuses, and says so', async () => {
    let answer: (result: { data: unknown; error: unknown }) => void = () => undefined;
    mockWriteResult = () => new Promise((resolve) => (answer = resolve));
    const el = await mount(<TagsDashboardScreen />);

    click(byLabel(el, 'Van: inactive'));
    await settle(2);
    expect(byLabel(el, 'Van, Physical tag, Active')).not.toBeNull();

    await act(async () => answer({ data: null, error: new Error('permission denied') }));
    await settle();
    expect(byLabel(el, 'Van, Physical tag, Inactive')).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't activate the tag"), 'error');
  });
});

// ─── A tag's detail ─────────────────────────────────────────────────────

describe("a tag's detail", () => {
  it('shows the short code and destination, and offers neither as a field', async () => {
    mockParams.current = { id: 't1' };
    const el = await mount(<TagDetailScreen />);
    expect(el.textContent).toContain('ABC23XYZ');
    expect(el.textContent).toContain('Ana Studio · @ana_studio');
    const fields = Array.from(el.querySelectorAll('input')).map((input) => input.getAttribute('aria-label'));
    expect(fields).toEqual(['Name', 'Note']);
    expect(Array.from(el.querySelectorAll('input')).some((input) => input.value === 'ABC23XYZ')).toBe(false);
  });

  it('shows a Physical Tag its QR and the way to export it', async () => {
    mockParams.current = { id: 't1' };
    const el = await mount(<TagDetailScreen />);
    expect(el.querySelector('[data-qr]')!.getAttribute('data-qr')).toBe(buildTagUrl('ABC23XYZ'));
    click(byText(el, 'Export QR code'));
    expect(mockRouter.push).toHaveBeenCalledWith('/tags/t1/export');
  });

  it('shows a Digital Tag its link, and no replacement', async () => {
    mockParams.current = { id: 't-link' };
    const el = await mount(<TagDetailScreen />);
    expect(el.querySelector('[data-qr]')).toBeNull();
    expect(byLabel(el, `Tag link, ${buildTagUrl('LNK23456')}`)).not.toBeNull();
    expect(byText(el, 'Copy link')).toBeDefined();
    expect(byText(el, 'Share link')).toBeDefined();
    expect(el.textContent).not.toContain('Create a replacement');
  });

  it('saves the name and note, and nothing else', async () => {
    mockParams.current = { id: 't1' };
    const el = await mount(<TagDetailScreen />);
    const save = byText(el, 'Save changes') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const name = el.querySelector('input[aria-label="Name"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Back door');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText(el, 'Save changes'));
    await settle();
    expect(mockWrites).toHaveBeenCalledWith('update', { name: 'Back door', note: null }, [['id', 't1']]);
  });

  it('says what deleting means before removing anything, then deletes', async () => {
    mockParams.current = { id: 't1' };
    const el = await mount(<TagDetailScreen />);
    click(buttons(el).find((b) => b.textContent?.startsWith('Delete tag')));

    const [title, body, actions] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe('Delete this tag?');
    expect(body).toContain('Anything printed with ABC23XYZ will stop working for everyone, permanently.');
    expect(mockWrites).not.toHaveBeenCalled();

    await act(async () => actions.find((a) => a.text === 'Delete permanently')!.onPress!());
    await settle();
    expect(mockWrites).toHaveBeenCalledWith('delete', undefined, [['id', 't1']]);
    expect(mockRouter.back).toHaveBeenCalled();
    expect(client.getQueryData<{ id: string }[]>(tagKeys.mine('p-studio'))!.map((t) => t.id)).not.toContain('t1');
  });

  it('replaces a Physical Tag with its destination carried over, leaving the original listed', async () => {
    mockParams.current = { id: 't1' };
    const el = await mount(<TagDetailScreen />);
    click(buttons(el).find((b) => b.textContent?.startsWith('Create a replacement')));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/tags/create',
      params: { type: 'physical', destination: 'p-studio' },
    });
    expect(mockWrites).not.toHaveBeenCalled();
    expect(client.getQueryData<{ id: string }[]>(tagKeys.mine('p-studio'))!.map((t) => t.id)).toContain('t1');
  });

  it("says so when the profile owns no such tag, with a way back to its tags", async () => {
    mockParams.current = { id: 't-ana' };
    const el = await mount(<TagDetailScreen />);
    expect(el.textContent).toContain('Tag not found');
    click(byText(el, 'Your tags'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/tags');
  });
});
