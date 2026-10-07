/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/projects/projects.test.tsx
//
// Projects (ONE-41): the data layer, the screen logic, and the project page,
// create, edit and product picker screens, mounted over the real projects,
// products, tags and saves features and a real query client. Only the
// Supabase client (an in-memory database), the router, the acting profile and
// the native pickers are faked. Who may read a private project is RLS's to
// decide, and pgTAP tests it (supabase/tests/projects.test.sql); here the
// database hides what it would hide from the viewer each test plays.
//
//   1. A public project renders fully for someone signed out, every section a
//      way onward; a private one reads as not found to an unrelated account
//      and in full to a contributor.
//   2. Its owner Links products from any business, through a picker that
//      searches them all, and they appear under Products used.
//   3. Only the owner gets edit, link and delete controls; deleting names what
//      it destroys first. Only the owner sees scan counts.
//   4. Empty sections prompt the owner and explain to a visitor.
//   5. Create and edit write the project, its cover filed under the account.
//   6. A project can sit inside another, one level deep (ONE-134): the house
//      lists what it includes, each names the house it is part of — to those
//      who may see the house — and deleting the house says what goes with it.
//   7. A project is Public, Unlisted or Private (ONE-137): the form writes the
//      choice, the page badges it, and Make public lifts Unlisted too.
//   8. A project keeps details its owner defines (ONE-140): the form adds them,
//      from a template or one by one, saves only those with a value, in order,
//      and the page shows them, a date in the device's locale and a link that
//      opens.
//   9. A project keeps a log (ONE-141): its owner adds, edits and deletes
//      entries, naming who did the work from a profile search; the page shows
//      each one, who did it a tap from their profile; and the profile named
//      can take its name off.
//  10. Others write to it (ONE-143): a Contributor adds to it, a business
//      that scanned its tag proposes an entry, and the owner approves or
//      declines it from Waiting for you.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode; accessibilityLabel?: string }) =>
    React.createElement('div', { 'aria-label': props.accessibilityLabel }, props.children);
  const slot = (node: unknown) =>
    typeof node === 'function' ? React.createElement(node as React.ComponentType) : (node as React.ReactNode) ?? null;
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListEmptyComponent?: unknown;
  }) =>
    React.createElement(
      'div',
      null,
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
    Linking: { openURL: (url: string) => mockOpenURL(url) },
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 375, height: 812 }),
  };
});
const mockOpenURL = jest.fn((_url: string) => Promise.resolve());
// The picker hands back whatever date the test puts in mockPickedDate.
let mockPickedDate = new Date(2026, 2, 4);
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (p: { onChange: (e: { type: string }, d?: Date) => void }) =>
      React.createElement('button', {
        'aria-label': 'Date picker',
        onClick: () => p.onChange({ type: 'set' }, mockPickedDate),
      }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => {
  const React = require('react');
  return {
    Image: (p: { source?: { uri?: string }; accessibilityLabel?: string }) =>
      React.createElement('img', { src: p.source?.uri, 'aria-label': p.accessibilityLabel }),
  };
});

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: { current: Record<string, string> } = { current: {} };
const mockHeader: { title?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  Stack: {
    Screen: (p: { options?: { title?: string; headerLeft?: () => unknown; headerRight?: () => unknown } }) => {
      mockHeader.title = p.options?.title;
      const React = require('react');
      return React.createElement(React.Fragment, null, p.options?.headerLeft?.() ?? null, p.options?.headerRight?.() ?? null);
    },
  },
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const mockActing: {
  profileId: string | undefined;
  authUserId: string | undefined;
  status: string;
  profile: { id: string; name: string; username: string; profilePicture: string | null };
} = {
  profileId: 'p-builder',
  authUserId: 'a-builder',
  status: 'ready',
  profile: { id: 'p-builder', name: 'Ana Builds', username: 'ana_builds', profilePicture: null },
};
// Who did a log entry's work is found by handle (ONE-141); every search finds these.
const mockProfileResults = [
  { id: 'p-acme', username: 'acme_hvac', name: 'Acme HVAC', avatarUrl: null, isVerified: false, profileType: 'business' },
];
jest.mock('../../../features/profiles', () => ({
  useCurrentProfile: () => mockActing,
  PROFILE_SEARCH_MIN_LENGTH: 2,
  useProfileSearchQuery: () => ({ data: mockProfileResults, isFetching: false, isError: false, refetch: jest.fn() }),
}));
const mockAuth = { status: 'signed-in' };
jest.mock('../../../features/auth', () => ({ useAuthStatus: () => mockAuth.status }));

jest.mock('../../../services/destinationSharing', () => ({ shareDestination: jest.fn(() => Promise.resolve()) }));
const mockPick = jest.fn();
jest.mock('../../../services/mediaPicker', () => ({ pickImageFromLibrary: (...a: unknown[]) => mockPick(...a) }));
jest.mock('../../../services/localFile', () => ({
  readLocalFile: () => Promise.resolve({ arrayBuffer: new ArrayBuffer(1), contentType: 'image/jpeg', ext: 'jpg' }),
}));
jest.mock('../../../services/supabase.native', () => require('../../support/mockSupabaseDb').supabaseModule());

import { Alert } from 'react-native';
import { canSee, db, resetDb } from '../../support/mockSupabaseDb';
import ProjectScreen from '../../../app/project/[id]';
import CreateProjectScreen from '../../../app/project/create';
import EditProjectScreen from '../../../app/project/[id]/edit';
import LinkProductScreen from '../../../app/project/[id]/link-product';
import LogEntryScreen from '../../../app/project/[id]/log';
import { fetchContributedProjects, linkProduct } from '../../../features/projects';
import {
  canManageProject,
  deleteProjectConfirm,
  projectStats,
  EMPTY_PROJECT_DRAFT,
  projectDraftValid,
} from '../../../lib/screens/projects';

// ─── The database ───────────────────────────────────────────────────────

// The builder's account and profile have different ids, as every profile made
// after signup does (ONE-21).
const PROFILES = [
  { id: 'p-builder', username: 'ana_builds', full_name: 'Ana Builds', avatar_url: null, is_verified: false, profile_type: 'individual' },
  { id: 'p-tiles', username: 'tile_co', full_name: 'Tile Co', avatar_url: null, is_verified: true, profile_type: 'business' },
  { id: 'p-oak', username: 'oak_studio', full_name: 'Oak Studio', avatar_url: null, is_verified: false, profile_type: 'business' },
  { id: 'p-stranger', username: 'someone', full_name: 'Someone', avatar_url: null, is_verified: false, profile_type: 'individual' },
];

const BARN = {
  id: 'pj-barn',
  owner_profile_id: 'p-builder',
  name: 'Barn conversion',
  project_type: 'Renovation',
  year: '2025',
  description: 'A 1900s barn, now a home.',
  cover_url: 'https://cdn.example/barn.jpg',
  is_public: true,
  created_at: '2026-01-01T00:00:00Z',
};

/** Who the database thinks is asking, standing in for RLS. */
const viewer = { profileId: 'p-builder' as string | null };

const isContributor = (projectId: unknown) =>
  db.tables.contributors!.some((c) => c.project_id === projectId && c.contributor_profile_id === viewer.profileId);
const projectVisible = (project: Record<string, unknown>) =>
  project.is_public === true || project.owner_profile_id === viewer.profileId || isContributor(project.id);

const seed = () => {
  resetDb({
    profiles: PROFILES,
    projects: [BARN],
    contributors: [
      { id: 'c-tiles', project_id: 'pj-barn', contributor_profile_id: 'p-tiles', role: 'Supplied the tile', is_public: true, added_at: '2026-01-02T00:00:00Z' },
    ],
    products: [
      { id: 'pd-door', business_profile_id: 'p-oak', name: 'Oak door', category: 'Doors', price_cents: null, currency: 'USD', available: true, created_at: '2026-01-05T00:00:00Z' },
      { id: 'pd-tile', business_profile_id: 'p-tiles', name: 'Zellige tile', category: 'Tile', price_cents: 1200, currency: 'USD', available: true, created_at: '2026-01-06T00:00:00Z' },
    ],
    product_media: [{ id: 'm1', product_id: 'pd-tile', url: 'https://cdn.example/tile.jpg', media_type: 'photo', sort_order: 0 }],
    project_products: [{ id: 'pp-1', project_id: 'pj-barn', product_id: 'pd-tile' }],
    project_details: [],
    project_log_entries: [],
    project_log_media: [],
    tags: [
      { id: 't-1', owner_profile_id: 'p-builder', dest_project_id: 'pj-barn' },
      { id: 't-2', owner_profile_id: 'p-builder', dest_project_id: 'pj-barn' },
      { id: 't-other', owner_profile_id: 'p-builder', dest_project_id: 'pj-elsewhere' },
    ],
    saves: [],
  });
  viewer.profileId = 'p-builder';

  const profile = (id: unknown) => db.tables.profiles!.find((p) => p.id === id) ?? null;
  const product = (id: unknown) => {
    const row = db.tables.products!.find((p) => p.id === id);
    return row ? { ...row, product_media: db.tables.product_media!.filter((m) => m.product_id === id) } : null;
  };
  const project = (id: unknown) => {
    const row = db.tables.projects!.find((p) => p.id === id) ?? null;
    return canSee('projects', row) ? row : null;
  };

  db.visible = {
    projects: projectVisible,
    contributors: (c) => {
      const p = db.tables.projects!.find((row) => row.id === c.project_id);
      if (!p || !projectVisible(p)) return false;
      return c.is_public === true || p.owner_profile_id === viewer.profileId || c.contributor_profile_id === viewer.profileId;
    },
    project_products: (pp) => project(pp.project_id) !== null,
  };
  db.embeds = {
    // The parent embed reads under the viewer's RLS, as PostgREST's does.
    projects: (row) => {
      const parent = row.parent_project_id ? project(row.parent_project_id) : null;
      return {
        ...row,
        owner: profile(row.owner_profile_id),
        parent: parent ? { id: parent.id, name: parent.name } : null,
        details: db.tables.project_details!.filter((d) => d.project_id === row.id),
      };
    },
    contributors: (row, select) =>
      select.includes('project:') ? { project: project(row.project_id) } : { ...row, profile: profile(row.contributor_profile_id) },
    project_products: (row, select) =>
      select.includes('project:') ? { project: project(row.project_id) } : { id: row.id, product: product(row.product_id) },
    products: (row) => ({ ...product(row.id), business: profile(row.business_profile_id) }),
    project_log_entries: (row) => ({
      ...row,
      performed_by: profile(row.performed_by_profile_id),
      author: profile(row.author_profile_id),
      photos: db.tables.project_log_media!.filter((m) => m.entry_id === row.id),
    }),
  };
  db.rpcResults = {
    tag_scan_counts: (args) =>
      args.p_owner_profile_id === viewer.profileId
        ? [
            { tag_id: 't-1', scan_count: 5, last_scanned_at: null },
            { tag_id: 't-2', scan_count: '7', last_scanned_at: null },
            { tag_id: 't-other', scan_count: 100, last_scanned_at: null },
          ]
        : [],
  };
};

/** Play a viewer: who the app acts as, and who the database answers. */
const actAs = (profileId: string | null) => {
  viewer.profileId = profileId;
  mockActing.profileId = profileId ?? undefined;
  mockActing.authUserId = profileId ? `a-${profileId}` : undefined;
  mockActing.status = profileId ? 'ready' : 'signed-out';
  const row = PROFILES.find((p) => p.id === profileId);
  mockActing.profile = { id: profileId ?? '', name: row?.full_name ?? '', username: row?.username ?? '', profilePicture: null };
  mockAuth.status = profileId ? 'signed-in' : 'signed-out';
};

// ─── Mounting ───────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(screen: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={client}>{screen}</QueryClientProvider>));
  await settle();
  return container;
}

async function remount(screen: React.ReactElement): Promise<HTMLDivElement> {
  if (root) act(() => root!.unmount());
  container?.remove();
  client.clear();
  return mount(screen);
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const blur = async (el: HTMLElement, label: string) => {
  act(() => {
    byLabel(el, label)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await settle(2);
};
const click = async (target: HTMLElement | null | undefined) => {
  act(() => (target as HTMLElement).click());
  await settle();
};
const type = async (el: HTMLElement, label: string, value: string) => {
  const input = byLabel(el, label) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(2);
};

beforeEach(() => {
  jest.useRealTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seed();
  actAs('p-builder');
  mockParams.current = { id: 'pj-barn' };
  [mockRouter.push, mockRouter.back, mockRouter.replace, mockToast, mockPick, mockOpenURL].forEach((m) => m.mockClear());
  mockPick.mockReset();
  mockRouter.canGoBack.mockReturnValue(true);
  (Alert.alert as jest.Mock).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

// ─── Screen logic ───────────────────────────────────────────────────────

describe('the screen logic', () => {
  it('lets only the owning profile manage a project, whatever its type', () => {
    expect(canManageProject('p-builder', { ownerProfileId: 'p-builder' })).toBe(true);
    expect(canManageProject('p-tiles', { ownerProfileId: 'p-builder' })).toBe(false);
    expect(canManageProject(undefined, { ownerProfileId: 'p-builder' })).toBe(false);
  });

  it('counts contributors and products, and scans only when there are any to show', () => {
    expect(projectStats({ contributors: 1, products: 2 })).toEqual(['1 contributor', '2 products']);
    expect(projectStats({ contributors: 0, products: 1, scans: 12 })).toEqual(['0 contributors', '1 product', '12 scans']);
  });

  it('needs only a name', () => {
    expect(projectDraftValid(EMPTY_PROJECT_DRAFT)).toBe(false);
    expect(projectDraftValid({ ...EMPTY_PROJECT_DRAFT, name: 'Loft' })).toBe(true);
    expect(EMPTY_PROJECT_DRAFT.visibility).toBe('public');
  });

  it('names what deleting destroys: the contributors\' link and every tag pointing at it', () => {
    const { body } = deleteProjectConfirm({ name: 'Barn' });
    expect(body).toMatch(/contributors lose the link/);
    expect(body).toMatch(/Any tag pointing at it stops working for good/);
    expect(body).toMatch(/make it private instead/);
  });
});

describe('the data layer', () => {
  it('lists a profile\'s contributed projects without the ones the viewer may not see', async () => {
    db.tables.projects!.push({ ...BARN, id: 'pj-secret', name: 'Secret', is_public: false, owner_profile_id: 'p-oak' });
    db.tables.contributors!.push({ id: 'c-2', project_id: 'pj-secret', contributor_profile_id: 'p-tiles', role: null, is_public: true, added_at: '2026-01-03T00:00:00Z' });
    viewer.profileId = 'p-stranger';
    expect((await fetchContributedProjects('p-tiles')).map((p) => p.name)).toEqual(['Barn conversion']);
    viewer.profileId = 'p-tiles';
    expect((await fetchContributedProjects('p-tiles')).map((p) => p.name).sort()).toEqual(['Barn conversion', 'Secret']);
  });

  it('treats Linking a product already Linked as done', async () => {
    db.failNext = { table: 'project_products', kind: 'insert', error: { code: '23505', message: 'duplicate' } };
    await expect(linkProduct('pj-barn', 'pd-tile')).resolves.toBeUndefined();
  });
});

// ─── 1. Reading a project ───────────────────────────────────────────────

describe('the project page', () => {
  it('renders fully for someone signed out, when public', async () => {
    actAs(null);
    const el = await mount(<ProjectScreen />);

    expect(mockHeader.title).toBe('Barn conversion');
    expect(byLabel(el, 'Barn conversion, cover photo')!.getAttribute('src')).toBe('https://cdn.example/barn.jpg');
    const text = el.textContent ?? '';
    expect(text).toContain('Project · Renovation · 2025');
    expect(text).toContain('A 1900s barn, now a home.');
    expect(byLabel(el, 'By Ana Builds, @ana_builds')).not.toBeNull();
    expect(byLabel(el, 'Contributors')!.textContent).toContain('Tile Co');
    expect(byLabel(el, 'Products used')!.textContent).toContain('Zellige tile');
    expect(byLabel(el, '1 contributor · 1 product')).not.toBeNull();
    expect(byText(el, 'Sign up to save')).toBeTruthy();
    expect(byLabel(el, 'Manage project')).toBeNull();
  });

  it('routes every section onward: owner, contributors and products', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'By Ana Builds, @ana_builds'));
    expect(mockRouter.push).toHaveBeenCalledWith('/user/ana_builds');
    await click(buttons(byLabel(el, 'Contributors')!).find((b) => b.textContent?.includes('Tile Co')));
    expect(mockRouter.push).toHaveBeenCalledWith('/user/tile_co');
    await click(buttons(byLabel(el, 'Products used')!).find((b) => b.textContent?.includes('Zellige tile')));
    expect(mockRouter.push).toHaveBeenCalledWith('/product/pd-tile');
  });

  it('shows a contributor\'s role and kind', async () => {
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Contributors')!.textContent).toContain('Supplied the tile · Business');
  });

  it('reads a private project as not found to an unrelated account, never as private', async () => {
    db.tables.projects![0]!.is_public = false;
    actAs('p-stranger');
    const el = await mount(<ProjectScreen />);
    expect(el.textContent).toContain('Project not found');
    expect(el.textContent).not.toMatch(/private/i);
    expect(el.textContent).not.toContain('Barn conversion');
  });

  it('reads a private project the same as one that never existed', async () => {
    db.tables.projects![0]!.is_public = false;
    actAs('p-stranger');
    const hidden = (await mount(<ProjectScreen />)).textContent;
    mockParams.current = { id: 'pj-never' };
    const missing = (await remount(<ProjectScreen />)).textContent;
    expect(hidden).toBe(missing);
  });

  it('renders a private project in full for one of its contributors', async () => {
    db.tables.projects![0]!.is_public = false;
    actAs('p-tiles');
    const el = await mount(<ProjectScreen />);
    expect(el.textContent).toContain('A 1900s barn, now a home.');
    expect(byLabel(el, 'Private')).not.toBeNull();
    expect(byLabel(el, 'Products used')!.textContent).toContain('Zellige tile');
  });

  it('says its products could not be read, with a way to try again, rather than that there are none', async () => {
    db.failNext = { table: 'project_products', kind: 'select', error: { message: 'boom' } };
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Products used')!.textContent).toContain("Couldn't load the products this project used.");
    expect(byLabel(el, 'Products used')!.textContent).not.toContain('No products Linked');
    await click(byText(byLabel(el, 'Products used')!, 'Try again'));
    expect(byLabel(el, 'Products used')!.textContent).toContain('Zellige tile');
  });

  it('goes home from Back when a tag opened it alone on the stack (ONE-90)', async () => {
    actAs(null);
    mockRouter.canGoBack.mockReturnValue(false);
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/signup');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('leaves Back to the native header when there is a screen to go back to (ONE-90)', async () => {
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Back')).toBeNull();
  });

  it('saves it as the active profile', async () => {
    actAs('p-stranger');
    const el = await mount(<ProjectScreen />);
    await click(byText(el, 'Save'));
    expect(db.tables.saves).toEqual([expect.objectContaining({ profile_id: 'p-stranger', saved_project_id: 'pj-barn' })]);
  });
});

// ─── 2. Linking products ────────────────────────────────────────────────

describe('Linking products', () => {
  it('searches every business\'s products, leaving out the ones already Linked', async () => {
    mockParams.current = { id: 'pj-barn' };
    const el = await mount(<LinkProductScreen />);
    // The owner is an individual with no products: every result is another business's.
    const rows = buttons(el).filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('Link '));
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual(['Link Oak door, by Oak Studio']);

    await type(el, 'Search products', 'zzz');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await settle();
    expect(el.textContent).toContain('No products match');
    expect(db.writes).toEqual([]);
  });

  it('Links another business\'s product, which then shows under Products used', async () => {
    const picker = await mount(<LinkProductScreen />);
    await click(byLabel(picker, 'Link Oak door, by Oak Studio'));
    expect(db.tables.project_products).toContainEqual(expect.objectContaining({ project_id: 'pj-barn', product_id: 'pd-door' }));
    expect(mockToast).toHaveBeenCalledWith('Linked Oak door.', 'success');
    // Linked now, so the picker no longer offers it.
    expect(byLabel(picker, 'Link Oak door, by Oak Studio')).toBeNull();

    const page = await remount(<ProjectScreen />);
    expect(byLabel(page, 'Products used')!.textContent).toContain('Oak door');
  });

  it('is the owner\'s alone', async () => {
    actAs('p-tiles');
    const el = await mount(<LinkProductScreen />);
    expect(el.textContent).toContain("You can't change this project");
    expect(byLabel(el, 'Search products')).toBeNull();
  });

  it('removes a Link on confirmation, leaving the product itself alone', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Remove Zellige tile from this project'));
    const [, body, actions] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toMatch(/The product itself is not changed/);
    await act(async () => {
      (actions as { text: string; onPress?: () => void }[]).find((a) => a.text === 'Remove')!.onPress!();
    });
    await settle();
    expect(db.tables.project_products).toEqual([]);
    expect(db.tables.products).toHaveLength(2);
    expect(byLabel(el, 'Products used')!.textContent).toContain('No products Linked yet');
  });
});

// ─── 3. The owner's controls ────────────────────────────────────────────

describe('managing a project', () => {
  it('shows a non-owner no edit, link or remove controls', async () => {
    actAs('p-stranger');
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Manage project')).toBeNull();
    expect(byText(el, 'Link a product')).toBeUndefined();
    expect(el.querySelector('[aria-label^="Remove "]')).toBeNull();
  });

  it('gives the owner edit, visibility and delete', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byText(el, 'Edit project'));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-barn/edit');
  });

  it('offers the owner a tag for it, pre-filled with the project (ONE-89)', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byLabel(el, 'Create tag'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tags/create', params: { destination: 'pj-barn', kind: 'project' } });
  });

  it('names that contributors lose the link and tags stop resolving, and deletes only on confirmation', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byText(el, 'Delete project'));
    const [title, body, actions] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Delete Barn conversion?');
    expect(body).toMatch(/Its contributors lose the link to it/);
    expect(body).toMatch(/Any tag pointing at it stops working for good/);
    expect(db.tables.projects).toHaveLength(1);

    await act(async () => {
      (actions as { text: string; onPress?: () => void }[]).find((a) => a.text === 'Delete permanently')!.onPress!();
    });
    await settle();
    expect(db.tables.projects).toHaveLength(0);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('makes it private, the softer alternative', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byLabel(el, 'Make private'));
    expect(db.tables.projects![0]!.is_public).toBe(false);
    expect(byLabel(el, 'Private')).not.toBeNull();
  });

  it('shows the owner how often their tags pointing here were scanned, and no one else', async () => {
    const owner = await mount(<ProjectScreen />);
    // 5 + 7 from the two tags pointing here; the tag pointing elsewhere is left out.
    expect(byLabel(owner, '1 contributor · 1 product · 12 scans')).not.toBeNull();

    actAs('p-stranger');
    db.rpcs = [];
    const visitor = await remount(<ProjectScreen />);
    expect(visitor.textContent).not.toMatch(/scan/i);
    expect(db.rpcs.filter((r) => r.name === 'tag_scan_counts')).toEqual([]);
  });
});

// ─── 4. Empty sections ──────────────────────────────────────────────────

describe('an empty project', () => {
  beforeEach(() => {
    db.tables.contributors = [];
    db.tables.project_products = [];
  });

  it('prompts its owner to add contributors and Link products', async () => {
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Contributors')!.textContent).toContain('Add the people and businesses who worked on this project');
    expect(byLabel(el, 'Products used')!.textContent).toContain('your own, or any business\'s');
    await click(byText(el, 'Link a product'));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-barn/link-product');
  });

  it('explains the idea to a visitor, with nothing for them to do', async () => {
    actAs('p-stranger');
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Contributors')!.textContent).toContain('Contributors are the people and businesses who worked on a project');
    expect(byLabel(el, 'Products used')!.textContent).toContain('Products used in a project show here');
    expect(byText(el, 'Link a product')).toBeUndefined();
  });
});

// ─── 5. Create and edit ─────────────────────────────────────────────────

describe('creating and editing a project', () => {
  it('lets an individual profile start one, its cover filed under the account', async () => {
    mockPick.mockResolvedValue({ status: 'selected', media: { uri: 'file:///cover.jpg', width: 4, height: 3, mediaType: 'image' } });
    const el = await mount(<CreateProjectScreen />);
    await click(byLabel(el, 'Add a cover photo'));
    await type(el, 'Name', 'Kitchen remodel');
    await type(el, 'Year', '2026');
    await click(byLabel(el, 'Save'));

    const created = db.tables.projects!.find((p) => p.name === 'Kitchen remodel')!;
    expect(created).toMatchObject({ owner_profile_id: 'p-builder', year: '2026', is_public: true });
    expect(db.uploads).toEqual([{ bucket: 'post-media', path: expect.stringMatching(/^projects\/a-p-builder\//) }]);
    expect(created.cover_url).toBe(`https://cdn.example/post-media/${db.uploads[0]!.path}`);
    expect(mockRouter.replace).toHaveBeenCalledWith(`/project/${created.id}`);
  });

  it('saves a change of visibility, and nothing until something changes', async () => {
    const el = await mount(<EditProjectScreen />);
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await click(byLabel(el, 'Visibility: Private'));
    expect(el.textContent).toContain('Only you and its contributors can see it');
    await click(byLabel(el, 'Save'));
    expect(db.tables.projects![0]).toMatchObject({ is_public: false, cover_url: 'https://cdn.example/barn.jpg' });
    // The stored cover was kept, not uploaded again.
    expect(db.uploads).toEqual([]);
  });

  it('gives the form only to the owner', async () => {
    actAs('p-tiles');
    const el = await mount(<EditProjectScreen />);
    expect(el.textContent).toContain("You can't edit this project");
    expect(byLabel(el, 'Name')).toBeNull();
  });
});

// ─── Projects inside a project (ONE-134) ────────────────────────────────

describe('projects inside a project', () => {
  const FURNACE = {
    ...BARN,
    id: 'pj-furnace',
    name: 'Furnace',
    project_type: 'HVAC',
    description: null,
    cover_url: null,
    parent_project_id: 'pj-barn',
    created_at: '2026-02-01T00:00:00Z',
  };

  beforeEach(() => {
    db.tables.projects!.push({ ...FURNACE });
  });

  it("lists what the house includes, each leading to its page, with the owner's Add a project", async () => {
    const el = await mount(<ProjectScreen />);
    expect(el.textContent).toContain('Includes');
    await click(byLabel(el, 'Furnace, HVAC · 2025'));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-furnace');
    await click(byText(el, 'Add a project'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/create', params: { parent: 'pj-barn' } });
  });

  it("names the house a project is part of, leading back to it", async () => {
    mockParams.current = { id: 'pj-furnace' };
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Part of Barn conversion'));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-barn');
    // One level deep: a project inside another includes nothing itself.
    expect(el.textContent).not.toContain('Includes');
  });

  it("doesn't name a house the viewer may not see", async () => {
    db.tables.projects!.find((p) => p.id === 'pj-barn')!.is_public = false;
    actAs('p-stranger');
    mockParams.current = { id: 'pj-furnace' };
    const el = await mount(<ProjectScreen />);
    expect(el.textContent).toContain('Furnace');
    expect(el.textContent).not.toContain('Part of');
  });

  it('shows a visitor what a house includes, without the owner\'s controls', async () => {
    actAs('p-stranger');
    const el = await mount(<ProjectScreen />);
    expect(el.textContent).toContain('Includes');
    expect(byText(el, 'Add a project')).toBeUndefined();
  });

  it('shows an owner an empty Includes, with a prompt, and a visitor nothing', async () => {
    db.tables.projects = db.tables.projects!.filter((p) => p.id !== 'pj-furnace');
    const owner = await mount(<ProjectScreen />);
    expect(owner.textContent).toContain('Nothing inside it yet');
    actAs('p-stranger');
    const visitor = await remount(<ProjectScreen />);
    expect(visitor.textContent).not.toContain('Includes');
  });

  it('says what goes with the house when it is deleted', async () => {
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byText(el, 'Delete project'));
    const [, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toMatch(/^This also deletes the 1 project inside it\. /);
  });

  it('creates a project inside the house it was started from', async () => {
    mockParams.current = { parent: 'pj-barn' };
    const el = await mount(<CreateProjectScreen />);
    expect(byLabel(el, 'Part of: Barn conversion')).not.toBeNull();
    await type(el, 'Name', 'Water heater');
    await click(byLabel(el, 'Save'));
    expect(db.tables.projects!.find((p) => p.name === 'Water heater')).toMatchObject({ parent_project_id: 'pj-barn' });
  });

  it('moves a project into another of the owner\'s from its edit form', async () => {
    db.tables.projects!.push({ ...BARN, id: 'pj-shed', name: 'Shed', created_at: '2026-03-01T00:00:00Z' });
    mockParams.current = { id: 'pj-shed' };
    const el = await mount(<EditProjectScreen />);
    await click(byLabel(el, 'Part of: None'));
    await click(byText(el, 'Barn conversion'));
    await click(byLabel(el, 'Save'));
    expect(db.tables.projects!.find((p) => p.id === 'pj-shed')).toMatchObject({ parent_project_id: 'pj-barn' });
  });

  it("doesn't offer Part of on a project that holds others: one level only", async () => {
    db.tables.projects!.push({ ...BARN, id: 'pj-shed', name: 'Shed', created_at: '2026-03-01T00:00:00Z' });
    const el = await mount(<EditProjectScreen />);
    expect(el.querySelector('[aria-label^="Part of"]')).toBeNull();
  });
});

// ─── Unlisted (ONE-137) ─────────────────────────────────────────────────

describe('an unlisted project', () => {
  it('is chosen on the form, written as unlisted and not public', async () => {
    const el = await mount(<EditProjectScreen />);
    await click(byLabel(el, 'Visibility: Unlisted'));
    expect(el.textContent).toContain("Anyone with its tag can see it, but it isn't listed anywhere");
    await click(byLabel(el, 'Save'));
    expect(db.tables.projects![0]).toMatchObject({ is_public: false, unlisted: true });
  });

  it('starts the edit form on Unlisted when it is', async () => {
    Object.assign(db.tables.projects![0]!, { is_public: false, unlisted: true });
    const el = await mount(<EditProjectScreen />);
    expect(byLabel(el, 'Visibility: Unlisted, selected')).not.toBeNull();
  });

  it('is badged Unlisted on its page', async () => {
    Object.assign(db.tables.projects![0]!, { is_public: false, unlisted: true });
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Unlisted')!.textContent).toBe('Unlisted');
  });

  it('is made public from the menu, and no longer unlisted', async () => {
    Object.assign(db.tables.projects![0]!, { is_public: false, unlisted: true });
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Manage project'));
    await click(byLabel(el, 'Make public'));
    expect(db.tables.projects![0]).toMatchObject({ is_public: true, unlisted: false });
  });
});

// ─── Details (ONE-140) ──────────────────────────────────────────────────

describe('project details', () => {
  const detailRows = () =>
    db.tables
      .project_details!.filter((d) => d.project_id === 'pj-barn')
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));

  const storeDetails = () => {
    db.tables.project_details!.push(
      { id: 'd-make', project_id: 'pj-barn', label: 'Make', kind: 'text', value: 'Acme', sort_order: 0 },
      { id: 'd-installed', project_id: 'pj-barn', label: 'Installed', kind: 'date', value: '2026-03-04', sort_order: 1 },
      { id: 'd-manual', project_id: 'pj-barn', label: 'Manual', kind: 'link', value: 'https://acme.test/manual', sort_order: 2 },
    );
  };

  it('shows them on the page in order, a date for the locale and a link that opens when tapped', async () => {
    storeDetails();
    actAs(null);
    const el = await mount(<ProjectScreen />);
    const section = byLabel(el, 'Details')!;
    expect(section.textContent).toMatch(/Make.*Acme.*Installed.*2026.*Manual.*acme\.test\/manual/);
    expect(byLabel(el, `Installed, ${new Date(2026, 2, 4).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`)).not.toBeNull();
    await click(byLabel(el, 'Manual, acme.test/manual'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://acme.test/manual');
  });

  it("isn't shown when there are none", async () => {
    const el = await mount(<ProjectScreen />);
    expect(byLabel(el, 'Details')).toBeNull();
  });

  it('saves only the details with a value: the HVAC template with Model number filled stores one row', async () => {
    const el = await mount(<CreateProjectScreen />);
    await type(el, 'Name', 'Furnace');
    await click(byText(el, 'Start from a template'));
    await click(byLabel(el, 'HVAC'));
    expect((byLabel(el, 'Detail 2 label') as HTMLInputElement).value).toBe('Model number');
    // A template is offered only while there are no details.
    expect(byText(el, 'Start from a template')).toBeUndefined();
    await type(el, 'Detail 2 value', 'XR-200');
    await click(byLabel(el, 'Save'));

    const created = db.tables.projects!.find((p) => p.name === 'Furnace')!;
    expect(db.tables.project_details!.filter((d) => d.project_id === created.id)).toEqual([
      expect.objectContaining({ label: 'Model number', kind: 'text', value: 'XR-200', sort_order: 0 }),
    ]);
  });

  it('adds a detail of a kind, a date from the picker', async () => {
    mockPickedDate = new Date(2026, 9, 1);
    const el = await mount(<EditProjectScreen />);
    await click(byText(el, 'Add a detail'));
    await click(byLabel(el, 'Date'));
    await type(el, 'Detail 1 label', 'Last serviced');
    await click(byLabel(el, 'Detail 1 value, no date yet'));
    await click(byLabel(el, 'Date picker'));
    await click(byText(el, 'Done'));
    await click(byLabel(el, 'Save'));
    expect(detailRows()).toEqual([expect.objectContaining({ label: 'Last serviced', kind: 'date', value: '2026-10-01' })]);
  });

  it('follows a new order and forgets a removed detail when saved again', async () => {
    storeDetails();
    const el = await mount(<EditProjectScreen />);
    await click(byLabel(el, 'Options for detail 3'));
    await click(byLabel(el, 'Move up'));
    await click(byLabel(el, 'Options for detail 1'));
    await click(byLabel(el, 'Remove detail'));
    await click(byLabel(el, 'Save'));
    expect(detailRows().map((d) => [d.id, d.sort_order])).toEqual([
      ['d-manual', 0],
      ['d-installed', 1],
    ]);
  });

  it("won't save a value that doesn't suit its kind, and says why once it is left", async () => {
    const el = await mount(<EditProjectScreen />);
    await click(byText(el, 'Add a detail'));
    await click(byLabel(el, 'Number'));
    await type(el, 'Detail 1 label', 'Capacity (gal)');
    await type(el, 'Detail 1 value', 'forty');
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await blur(el, 'Detail 1 value');
    expect(el.textContent).toContain('A number, like 40 or 2.5.');
    await type(el, 'Detail 1 value', '40');
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('writes nothing when its details are refused: the new project is deleted again', async () => {
    const el = await mount(<CreateProjectScreen />);
    await type(el, 'Name', 'Furnace');
    await click(byText(el, 'Add a detail'));
    await click(byLabel(el, 'Text'));
    await type(el, 'Detail 1 label', 'Make');
    await type(el, 'Detail 1 value', 'Acme');
    db.failNext = { table: 'project_details', kind: 'insert', error: { message: 'refused' } };
    await click(byLabel(el, 'Save'));
    expect(db.tables.projects!.find((p) => p.name === 'Furnace')).toBeUndefined();
    expect(mockToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});

// ─── The log (ONE-141) ──────────────────────────────────────────────────

describe('the project log', () => {
  const ACME = { id: 'p-acme', username: 'acme_hvac', full_name: 'Acme HVAC', avatar_url: null, is_verified: false, profile_type: 'business' };
  const entry = (overrides: Record<string, unknown>) => ({
    project_id: 'pj-barn',
    notes: null,
    cost_cents: null,
    currency: 'USD',
    performed_by_profile_id: null,
    created_at: '2026-03-12T10:00:00Z',
    updated_at: '2026-03-12T10:00:00Z',
    ...overrides,
  });
  // Newest first, as the database orders them.
  const storeLog = () => {
    db.tables.project_log_entries!.push(
      entry({
        id: 'e-igniter',
        occurred_on: '2026-03-12',
        title: 'Replaced the igniter',
        notes: 'Under warranty',
        cost_cents: 18000,
        performed_by_profile_id: 'p-acme',
      }),
      entry({ id: 'e-filter', occurred_on: '2026-01-05', title: 'Changed the filter' }),
    );
    db.tables.project_log_media!.push({ id: 'lm-1', entry_id: 'e-igniter', url: 'https://cdn.example/receipt.jpg', sort_order: 0 });
  };
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const confirmAlert = async () => {
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, { onPress?: () => void }[]];
    act(() => buttons[1]!.onPress!());
    await settle();
  };

  beforeEach(() => {
    db.tables.profiles!.push({ ...ACME });
    db.rpcResults.remove_me_from_log_entry = (args) => {
      const named = db.tables.project_log_entries!.find(
        (e) => e.id === args.p_entry_id && e.performed_by_profile_id === viewer.profileId,
      );
      if (named) named.performed_by_profile_id = null;
      return Boolean(named);
    };
  });

  it('shows each entry newest first: its day, what was done, who did it, its cost, notes and photos', async () => {
    storeLog();
    actAs(null);
    const el = await mount(<ProjectScreen />);
    const section = byLabel(el, 'Log')!;
    expect(section.textContent).toMatch(/Replaced the igniter.*Changed the filter/);
    expect(section.textContent).toContain('$180');
    expect(section.textContent).not.toContain('$180.00');
    expect(section.textContent).toContain('Under warranty');
    expect(byLabel(el, 'Replaced the igniter, photo 1 of 1')).not.toBeNull();
    // A visitor gets no options and no Add to log.
    expect(byLabel(el, 'Options for Replaced the igniter')).toBeNull();
    expect(byText(el, 'Add to log')).toBeUndefined();
  });

  it("opens the profile of who did the work when it's tapped", async () => {
    storeLog();
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Done by Acme HVAC, @acme_hvac'));
    expect(mockRouter.push).toHaveBeenCalledWith('/user/acme_hvac');
  });

  it('is left out for a visitor when empty, and prompts its owner to add to it', async () => {
    actAs('p-stranger');
    const visitor = await mount(<ProjectScreen />);
    expect(byLabel(visitor, 'Log')).toBeNull();
    actAs('p-builder');
    const owner = await remount(<ProjectScreen />);
    expect(byLabel(owner, 'Log')!.textContent).toContain('Nothing logged yet');
    await click(byText(owner, 'Add to log'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/pj-barn/log', params: {} });
  });

  it('logs an entry, naming who did it from a search, its cost a record', async () => {
    const el = await mount(<LogEntryScreen />);
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await type(el, 'What was done', 'Replaced the igniter');
    await click(byLabel(el, 'Who did it: no one named'));
    await type(el, 'Search profiles', 'acme');
    await click(byLabel(el, 'Choose Acme HVAC, @acme_hvac'));
    expect(byLabel(el, 'Who did it: Acme HVAC')).not.toBeNull();
    await type(el, 'Cost', '180');
    await click(byLabel(el, 'Save'));

    expect(db.tables.project_log_entries).toEqual([
      expect.objectContaining({
        project_id: 'pj-barn',
        occurred_on: today(),
        title: 'Replaced the igniter',
        cost_cents: 18000,
        currency: 'USD',
        performed_by_profile_id: 'p-acme',
      }),
    ]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("won't log a day that hasn't happened yet", async () => {
    mockPickedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const el = await mount(<LogEntryScreen />);
    await type(el, 'What was done', 'Booked a service');
    await click(el.querySelector('[aria-label^="When, "]') as HTMLElement);
    await click(byLabel(el, 'Date picker'));
    await click(byText(el, 'Done'));
    expect(el.textContent).toContain("That day hasn't happened yet.");
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits an entry from its menu, its photos with it', async () => {
    storeLog();
    const page = await mount(<ProjectScreen />);
    await click(byLabel(page, 'Options for Replaced the igniter'));
    await click(byLabel(page, 'Edit entry'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/pj-barn/log', params: { entry: 'e-igniter' } });

    mockParams.current = { id: 'pj-barn', entry: 'e-igniter' };
    const el = await remount(<LogEntryScreen />);
    expect((byLabel(el, 'What was done') as HTMLInputElement).value).toBe('Replaced the igniter');
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await click(byLabel(el, 'Photo 1 of 1'));
    await click(byLabel(el, 'Remove photo'));
    await type(el, 'Cost', '190');
    await click(byLabel(el, 'Save'));
    expect(db.tables.project_log_entries!.find((e) => e.id === 'e-igniter')).toMatchObject({
      cost_cents: 19000,
      performed_by_profile_id: 'p-acme',
    });
    expect(db.tables.project_log_media).toEqual([]);
  });

  it('deletes an entry only on confirmation', async () => {
    storeLog();
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Options for Changed the filter'));
    await click(byLabel(el, 'Delete entry'));
    expect(db.tables.project_log_entries).toHaveLength(2);
    await confirmAlert();
    expect(db.tables.project_log_entries!.map((e) => e.id)).toEqual(['e-igniter']);
  });

  it('lets the business named take its name off, leaving the entry', async () => {
    storeLog();
    actAs('p-acme');
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Options for Replaced the igniter'));
    expect(byLabel(el, 'Edit entry')).toBeNull();
    await click(byLabel(el, 'Remove me'));
    await confirmAlert();
    expect(db.tables.project_log_entries!.find((e) => e.id === 'e-igniter')).toMatchObject({
      title: 'Replaced the igniter',
      performed_by_profile_id: null,
    });
  });

  it('gives the form only to the owner', async () => {
    actAs('p-tiles');
    const el = await mount(<LogEntryScreen />);
    expect(el.textContent).toContain("You can't change this log");
    expect(byLabel(el, 'What was done')).toBeNull();
  });
});

// ─── Writing to someone else's log (ONE-143) ────────────────────────────

describe("writing to someone else's log", () => {
  // Tile Co is a Contributor on the barn; Oak Studio's account scanned its tag.
  const statusFor = (author: unknown) => (author === 'p-tiles' ? 'published' : author === 'p-oak' ? 'proposed' : null);
  const proposal = {
    id: 'e-boiler',
    project_id: 'pj-barn',
    occurred_on: '2026-04-01',
    title: 'Serviced the boiler',
    notes: null,
    cost_cents: 12000,
    currency: 'USD',
    performed_by_profile_id: 'p-oak',
    author_profile_id: 'p-oak',
    status: 'proposed',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
  };
  const confirmAlert = async () => {
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, { onPress?: () => void }[]];
    act(() => buttons[1]!.onPress!());
    await settle();
  };

  beforeEach(() => {
    db.rpcResults.log_entry_status_for = (args) => statusFor(args.p_author_profile_id);
    db.rpcResults.approve_log_entry = (args) => {
      const entry = db.tables.project_log_entries!.find((e) => e.id === args.p_entry_id)!;
      entry.status = 'published';
      db.tables.contributors!.push({
        id: 'c-oak',
        project_id: entry.project_id,
        contributor_profile_id: entry.author_profile_id,
        role: null,
        is_public: true,
        added_at: '2026-04-02T00:00:00Z',
      });
      return true;
    };
    // A proposal reaches only the project's owner and its author, as RLS has it.
    db.visible.project_log_entries = (e) =>
      e.status !== 'proposed' || viewer.profileId === 'p-builder' || viewer.profileId === e.author_profile_id;
  });

  it('lets a Contributor add to the log, as the one who did the work', async () => {
    actAs('p-tiles');
    const page = await mount(<ProjectScreen />);
    expect(byLabel(page, 'Log')!.textContent).toContain('Nothing logged yet');
    await click(byText(page, 'Add to log'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/pj-barn/log', params: {} });

    const el = await remount(<LogEntryScreen />);
    expect(byLabel(el, 'Who did it: Tile Co')).not.toBeNull();
    await type(el, 'What was done', 'Laid the tile');
    await click(byLabel(el, 'Save'));
    expect(db.tables.project_log_entries).toEqual([
      expect.objectContaining({
        title: 'Laid the tile',
        author_profile_id: 'p-tiles',
        status: 'published',
        performed_by_profile_id: 'p-tiles',
      }),
    ]);
    expect(mockToast).toHaveBeenCalledWith('Added to the log.', 'success');
  });

  it('lets a business that scanned its tag propose an entry, saying the owner approves it first', async () => {
    actAs('p-oak');
    const page = await mount(<ProjectScreen />);
    await click(byText(page, 'Propose a log entry'));

    const el = await remount(<LogEntryScreen />);
    expect(el.textContent).toContain('Propose a log entry');
    expect(el.textContent).toContain("The project's owner approves it before it shows on the log.");
    await type(el, 'What was done', 'Serviced the boiler');
    await click(byLabel(el, 'Save'));
    expect(db.tables.project_log_entries).toEqual([
      expect.objectContaining({ title: 'Serviced the boiler', author_profile_id: 'p-oak', status: 'proposed' }),
    ]);
    expect(mockToast).toHaveBeenCalledWith('Sent to the owner to approve.', 'success');
  });

  it('offers no way in to anyone else', async () => {
    actAs('p-stranger');
    const page = await mount(<ProjectScreen />);
    expect(byLabel(page, 'Log')).toBeNull();
    const el = await remount(<LogEntryScreen />);
    expect(el.textContent).toContain("You can't change this log");
  });

  it("shows the owner a proposal Waiting for you, which Approve publishes and Links its business", async () => {
    db.tables.project_log_entries!.push({ ...proposal });
    const el = await mount(<ProjectScreen />);
    const waiting = byLabel(el, 'Waiting for you')!;
    expect(waiting.textContent).toContain('Serviced the boiler');
    expect(waiting.textContent).toContain('Proposed by Oak Studio');
    await click(byLabel(el, 'Approve Serviced the boiler'));
    expect(db.rpcs).toContainEqual({ name: 'approve_log_entry', args: { p_entry_id: 'e-boiler' } });
    expect(db.tables.project_log_entries![0]).toMatchObject({ status: 'published' });
    expect(byLabel(el, 'Waiting for you')).toBeNull();
    expect(byLabel(el, 'Contributors')!.textContent).toContain('Oak Studio');
  });

  it('declines a proposal only on confirmation, deleting it', async () => {
    db.tables.project_log_entries!.push({ ...proposal });
    const el = await mount(<ProjectScreen />);
    await click(byLabel(el, 'Decline Serviced the boiler'));
    expect(db.tables.project_log_entries).toHaveLength(1);
    await confirmAlert();
    expect(db.tables.project_log_entries).toEqual([]);
  });

  it("marks a business's own proposal Waiting for approval, which it may edit, and hides it from everyone else", async () => {
    db.tables.project_log_entries!.push({ ...proposal });
    actAs('p-oak');
    const author = await mount(<ProjectScreen />);
    expect(byLabel(author, 'Log')!.textContent).toContain('Waiting for approval');
    expect(byLabel(author, 'Approve Serviced the boiler')).toBeNull();
    await click(byLabel(author, 'Options for Serviced the boiler'));
    expect(byLabel(author, 'Edit entry')).not.toBeNull();

    actAs('p-stranger');
    const visitor = await remount(<ProjectScreen />);
    expect(byLabel(visitor, 'Log')).toBeNull();
  });
});
