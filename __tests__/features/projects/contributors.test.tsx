/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/projects/contributors.test.tsx
//
// Contributors (ONE-42), mounted over the real projects, profiles-search and
// saves features and a real query client: the project page's contributors
// section and the picker that adds them. Only the Supabase client (an
// in-memory database standing in for RLS as the viewer each test plays), the
// router and the acting profile are faked. The policies themselves are
// pgTAP's (supabase/tests/projects.test.sql).
//
//   1. The owner adds business and individual profiles — themselves too —
//      from a search that leaves out whoever is already Linked.
//   2. A contributor sees "Remove me from this project" and nothing else to
//      manage, and removing themselves takes them off the list.
//   3. Anyone else sees no controls at all.
//   4. A hidden link is absent for visitors, and marked hidden for the owner
//      and that contributor, the only two who see it.
//   5. The other direction: a profile's contributed projects, private ones
//      only to those who may see them.
//   6. The word "vendor" appears nowhere, and nobody is "tagged in" a project.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import fs from 'fs';
import path from 'path';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
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
  return {
    ...shim,
    FlatList,
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 375, height: 812 }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../../support/expoImageStub'));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  Stack: {
    Screen: (p: { options?: { headerRight?: () => unknown } }) => (p.options?.headerRight ? p.options.headerRight() : null),
  },
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

// The real search hook runs; only the acting profile is supplied.
const mockActing: { profileId: string | undefined; authUserId: string | undefined; status: string } = {
  profileId: 'p-owner',
  authUserId: 'a-owner',
  status: 'ready',
};
jest.mock('../../../features/profiles', () => ({
  ...jest.requireActual('../../../features/profiles'),
  useCurrentProfile: () => mockActing,
}));
const mockAuth = { status: 'signed-in' };
jest.mock('../../../features/auth', () => ({ useAuthStatus: () => mockAuth.status, useAuthUserId: () => undefined }));

jest.mock('../../../services/destinationSharing', () => ({ shareDestination: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../services/supabase.native', () => require('../../support/mockSupabaseDb').supabaseModule());

import { Alert } from 'react-native';
import { canSee, db, resetDb } from '../../support/mockSupabaseDb';
import ProjectScreen from '../../../app/project/[id]';
import AddContributorScreen from '../../../app/project/[id]/add-contributor';
import { fetchContributedProjects, type Contributor } from '../../../features/projects';
import {
  contributorCandidates,
  contributorSubtitle,
  ownContributorLink,
  removeSelfConfirm,
} from '../../../lib/screens/projects';

// ─── The database ───────────────────────────────────────────────────────

const PROFILES = [
  { id: 'p-owner', username: 'ana_builds', full_name: 'Ana Builds', avatar_url: null, is_verified: false, profile_type: 'individual' },
  { id: 'p-tiles', username: 'tile_co', full_name: 'Tile Co', avatar_url: null, is_verified: true, profile_type: 'business' },
  { id: 'p-mason', username: 'tom_mason', full_name: 'Tom Mason', avatar_url: null, is_verified: false, profile_type: 'individual' },
  { id: 'p-hidden', username: 'quiet_tiler', full_name: 'Quiet Tiler', avatar_url: null, is_verified: false, profile_type: 'individual' },
  { id: 'p-stranger', username: 'someone', full_name: 'Someone', avatar_url: null, is_verified: false, profile_type: 'individual' },
];

const BARN = {
  id: 'pj-barn',
  owner_profile_id: 'p-owner',
  name: 'Barn conversion',
  project_type: 'Renovation',
  year: '2025',
  description: null,
  cover_url: null,
  is_public: true,
  created_at: '2026-01-01T00:00:00Z',
};

const viewer = { profileId: 'p-owner' as string | null };

const projectVisible = (project: Record<string, unknown>) =>
  project.is_public === true ||
  project.owner_profile_id === viewer.profileId ||
  db.tables.contributors!.some((c) => c.project_id === project.id && c.contributor_profile_id === viewer.profileId);

const seed = () => {
  resetDb({
    profiles: PROFILES,
    projects: [BARN],
    contributors: [
      { id: 'c-tiles', project_id: 'pj-barn', contributor_profile_id: 'p-tiles', role: 'Supplied the tile', is_public: true, added_at: '2026-01-02T00:00:00Z' },
      { id: 'c-hidden', project_id: 'pj-barn', contributor_profile_id: 'p-hidden', role: 'Grouting', is_public: false, added_at: '2026-01-03T00:00:00Z' },
    ],
    project_products: [],
    products: [],
    tags: [],
    saves: [],
  });
  viewer.profileId = 'p-owner';

  const profile = (id: unknown) => db.tables.profiles!.find((p) => p.id === id) ?? null;
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
  };
  db.embeds = {
    projects: (row) => ({ ...row, owner: profile(row.owner_profile_id) }),
    contributors: (row, select) =>
      select.includes('project:') ? { project: project(row.project_id) } : { ...row, profile: profile(row.contributor_profile_id) },
  };
  db.rpcResults = { tag_scan_counts: () => [] };
};

const actAs = (profileId: string | null) => {
  viewer.profileId = profileId;
  mockActing.profileId = profileId ?? undefined;
  mockActing.authUserId = profileId ? `a-${profileId}` : undefined;
  mockActing.status = profileId ? 'ready' : 'signed-out';
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
  if (root) act(() => root!.unmount());
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={client}>{screen}</QueryClientProvider>));
  await settle();
  return container;
}

/** A fresh read, as a reload would: the cache emptied first. */
const reload = (screen: React.ReactElement) => {
  client.clear();
  return mount(screen);
};

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
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
/** Type into the picker's search and wait out its debounce. */
const search = async (el: HTMLElement, value: string) => {
  await type(el, 'Search profiles', value);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  await settle();
};
const confirmAlert = async (choice: string) => {
  const actions = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => actions.find((a) => a.text === choice)!.onPress!());
  await settle();
};
const contributorsText = (el: HTMLElement) => byLabel(el, 'Contributors')!.textContent ?? '';

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seed();
  actAs('p-owner');
  mockParams.current = { id: 'pj-barn' };
  [mockRouter.push, mockRouter.back, mockRouter.replace, mockToast].forEach((m) => m.mockReset());
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

// ─── The rules, without mounting ────────────────────────────────────────

describe('contributor rules', () => {
  const link = (overrides: Partial<Contributor>): Contributor => ({
    id: 'c', projectId: 'pj', profileId: 'p-x', role: null, isPublic: true, addedAt: '', profile: null, ...overrides,
  });

  it('says a hidden link is hidden, then the role and the kind', () => {
    expect(contributorSubtitle({ role: 'Architect', isPublic: true, profile: { profileType: 'business' } as Contributor['profile'] }))
      .toBe('Architect · Business');
    expect(contributorSubtitle({ role: null, isPublic: false, profile: { profileType: 'individual' } as Contributor['profile'] }))
      .toBe('Hidden from visitors · Individual');
  });

  it('finds the active profile\'s own link only when it is not the owner', () => {
    const links = [link({ profileId: 'p-me' })];
    expect(ownContributorLink('p-me', { ownerProfileId: 'p-owner' }, links)).toBe(links[0]);
    expect(ownContributorLink('p-me', { ownerProfileId: 'p-me' }, links)).toBeNull();
    expect(ownContributorLink('p-other', { ownerProfileId: 'p-owner' }, links)).toBeNull();
    expect(ownContributorLink(undefined, { ownerProfileId: 'p-owner' }, links)).toBeNull();
  });

  it('offers everyone not already Linked, the owner included', () => {
    const results = [{ id: 'p-owner' }, { id: 'p-tiles' }, { id: 'p-hidden' }, { id: 'p-mason' }];
    const linked = [link({ profileId: 'p-tiles' }), link({ profileId: 'p-hidden', isPublic: false })];
    expect(contributorCandidates(results, linked).map((r) => r.id)).toEqual(['p-owner', 'p-mason']);
  });

  it('warns a contributor leaving a private project that they lose it', () => {
    expect(removeSelfConfirm({ name: 'Barn', isPublic: true }).body).not.toMatch(/private/);
    expect(removeSelfConfirm({ name: 'Barn', isPublic: false }).body).toMatch(/It's private, so you'll no longer be able to see it/);
    expect(removeSelfConfirm({ name: 'Barn', isPublic: true }).body).toMatch(/Only the project's owner can add you back/);
  });
});

// ─── 1. Adding ──────────────────────────────────────────────────────────

describe('adding contributors', () => {
  it('adds a business and an individual, and both appear on the project', async () => {
    db.tables.contributors = [];

    let picker = await mount(<AddContributorScreen />);
    await search(picker, 'tile');
    await click(byLabel(picker, 'Choose Tile Co, @tile_co, Business'));
    await type(picker, 'Role', 'Supplied the tile');
    await click(byText(picker, 'Add as contributor'));
    expect(mockToast).toHaveBeenCalledWith('Added Tile Co as a contributor.', 'success');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);

    picker = await mount(<AddContributorScreen />);
    await search(picker, 'mason');
    await click(byLabel(picker, 'Choose Tom Mason, @tom_mason, Individual'));
    await click(byText(picker, 'Add as contributor'));

    expect(db.tables.contributors).toEqual([
      expect.objectContaining({ project_id: 'pj-barn', contributor_profile_id: 'p-tiles', role: 'Supplied the tile' }),
      expect.objectContaining({ project_id: 'pj-barn', contributor_profile_id: 'p-mason', role: null }),
    ]);

    const page = await reload(<ProjectScreen />);
    expect(contributorsText(page)).toContain('Tile Co');
    expect(contributorsText(page)).toContain('Supplied the tile · Business');
    expect(contributorsText(page)).toContain('Tom Mason');
    expect(contributorsText(page)).toContain('Individual');
  });

  it('leaves out profiles already Linked, hidden ones included', async () => {
    const picker = await mount(<AddContributorScreen />);
    await search(picker, 'ti');
    const offered = buttons(picker).map((b) => b.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Choose '));
    // tile_co (public link) and quiet_tiler (hidden link) match "ti" but are Linked already.
    expect(offered).toEqual([]);
    expect(picker.textContent).toContain('No one to add');
  });

  it('lets the owner add themselves', async () => {
    const picker = await mount(<AddContributorScreen />);
    await search(picker, 'ana');
    await click(byLabel(picker, 'Choose Ana Builds, @ana_builds, Individual'));
    await type(picker, 'Role', 'Ran the job');
    await click(byText(picker, 'Add as contributor'));
    expect(db.tables.contributors).toContainEqual(
      expect.objectContaining({ contributor_profile_id: 'p-owner', role: 'Ran the job' }),
    );
  });

  it('is the owner\'s alone', async () => {
    actAs('p-tiles');
    const picker = await mount(<AddContributorScreen />);
    expect(picker.textContent).toContain("You can't change this project");
    expect(byLabel(picker, 'Search profiles')).toBeNull();
  });

  it('opens from the project page, for the owner', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byLabel(page, 'Add a contributor'));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-barn/add-contributor');
  });
});

// ─── 2. A contributor's side ────────────────────────────────────────────

describe('a contributor', () => {
  beforeEach(() => actAs('p-tiles'));

  it('sees "Remove me from this project" and no other management controls', async () => {
    const page = await mount(<ProjectScreen />);
    expect(byText(page, 'Remove me from this project')).toBeTruthy();
    expect(byLabel(page, 'Manage project')).toBeNull();
    expect(byLabel(page, 'Add a contributor')).toBeNull();
    expect(page.querySelector('[aria-label^="Options for"]')).toBeNull();
    expect(byText(page, 'Link a product')).toBeUndefined();
  });

  it('is gone from the list once they remove themselves', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byText(page, 'Remove me from this project'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Remove yourself from Barn conversion?');
    await confirmAlert('Remove me');

    expect(db.tables.contributors!.map((c) => c.contributor_profile_id)).toEqual(['p-hidden']);
    expect(contributorsText(page)).not.toContain('Tile Co');
    const reloaded = await reload(<ProjectScreen />);
    expect(contributorsText(reloaded)).not.toContain('Tile Co');
    expect(byText(reloaded, 'Remove me from this project')).toBeUndefined();
  });

  it('leaves a private project, which they can then no longer see', async () => {
    db.tables.projects![0]!.is_public = false;
    const page = await mount(<ProjectScreen />);
    await click(byText(page, 'Remove me from this project'));
    await confirmAlert('Remove me');
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('removes nothing until they confirm, and can cancel', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byText(page, 'Remove me from this project'));
    const actions = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
    expect(actions.find((a) => a.text === 'Cancel')).toEqual({ text: 'Cancel', style: 'cancel' });
    expect(db.tables.contributors).toHaveLength(2);
    expect(db.writes).toEqual([]);
  });
});

describe('when the contributors cannot be read', () => {
  it('says so, with a way to try again, rather than that there are none', async () => {
    db.failNext = { table: 'contributors', kind: 'select', error: { message: 'boom' } };
    const page = await mount(<ProjectScreen />);
    expect(contributorsText(page)).toContain("Couldn't load the contributors.");
    expect(contributorsText(page)).not.toContain('No contributors');
    await click(byText(byLabel(page, 'Contributors')!, 'Try again'));
    expect(contributorsText(page)).toContain('Tile Co');
  });
});

// ─── 3. Everyone else ───────────────────────────────────────────────────

describe('a visitor who is neither owner nor contributor', () => {
  it('sees no management controls at all', async () => {
    actAs('p-stranger');
    const page = await mount(<ProjectScreen />);
    expect(contributorsText(page)).toContain('Tile Co');
    expect(byText(page, 'Remove me from this project')).toBeUndefined();
    expect(byLabel(page, 'Add a contributor')).toBeNull();
    expect(page.querySelector('[aria-label^="Options for"]')).toBeNull();
    expect(byLabel(page, 'Manage project')).toBeNull();
  });
});

// ─── 4. Hidden links ────────────────────────────────────────────────────

describe('a hidden contributor link', () => {
  it('is absent for a visitor', async () => {
    actAs('p-stranger');
    const page = await mount(<ProjectScreen />);
    expect(contributorsText(page)).not.toContain('Quiet Tiler');
  });

  it('is absent for someone signed out', async () => {
    actAs(null);
    const page = await mount(<ProjectScreen />);
    expect(contributorsText(page)).toContain('Tile Co');
    expect(contributorsText(page)).not.toContain('Quiet Tiler');
  });

  it('is present and marked hidden for the owner', async () => {
    const page = await mount(<ProjectScreen />);
    expect(byLabel(page, 'Quiet Tiler, Hidden from visitors · Grouting · Individual')).not.toBeNull();
  });

  it('is present and marked hidden for that contributor', async () => {
    actAs('p-hidden');
    const page = await mount(<ProjectScreen />);
    expect(byLabel(page, 'Quiet Tiler, Hidden from visitors · Grouting · Individual')).not.toBeNull();
    expect(byText(page, 'Remove me from this project')).toBeTruthy();
  });

  it('is the owner\'s to hide or show, per row', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byLabel(page, 'Options for Tile Co'));
    await click(byLabel(page, 'Hide from visitors'));
    expect(db.tables.contributors!.find((c) => c.id === 'c-tiles')!.is_public).toBe(false);
    expect(byLabel(page, 'Tile Co, Hidden from visitors · Supplied the tile · Business')).not.toBeNull();

    await click(byLabel(page, 'Options for Quiet Tiler'));
    await click(byLabel(page, 'Show to visitors'));
    expect(db.tables.contributors!.find((c) => c.id === 'c-hidden')!.is_public).toBe(true);
  });
});

describe('the owner managing a link', () => {
  it('changes a role', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byLabel(page, 'Options for Tile Co'));
    await click(byLabel(page, 'Edit role'));
    await type(page, 'Role', 'Tile and grout');
    await click(byText(page, 'Save role'));
    expect(db.tables.contributors!.find((c) => c.id === 'c-tiles')!.role).toBe('Tile and grout');
    expect(contributorsText(page)).toContain('Tile and grout · Business');
  });

  it('removes a contributor on confirmation', async () => {
    const page = await mount(<ProjectScreen />);
    await click(byLabel(page, 'Options for Tile Co'));
    await click(byLabel(page, 'Remove from project'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Remove Tile Co?');
    await confirmAlert('Remove');
    expect(db.tables.contributors!.map((c) => c.id)).toEqual(['c-hidden']);
    expect(contributorsText(page)).not.toContain('Tile Co');
  });
});

// ─── 5. The other direction ─────────────────────────────────────────────

describe('a profile\'s contributed projects', () => {
  beforeEach(() => {
    db.tables.projects!.push({ ...BARN, id: 'pj-private', name: 'Private loft', is_public: false });
    db.tables.contributors!.push({
      id: 'c-private', project_id: 'pj-private', contributor_profile_id: 'p-tiles', role: null, is_public: true, added_at: '2026-02-01T00:00:00Z',
    });
  });

  it('include a private project for the contributor themselves', async () => {
    viewer.profileId = 'p-tiles';
    expect((await fetchContributedProjects('p-tiles')).map((p) => p.name).sort()).toEqual(['Barn conversion', 'Private loft']);
  });

  it('leave the private project out for a stranger', async () => {
    viewer.profileId = 'p-stranger';
    expect((await fetchContributedProjects('p-tiles')).map((p) => p.name)).toEqual(['Barn conversion']);
  });

  it('leave a hidden link out for a stranger, and keep it for that contributor', async () => {
    viewer.profileId = 'p-stranger';
    expect(await fetchContributedProjects('p-hidden')).toEqual([]);
    viewer.profileId = 'p-hidden';
    expect((await fetchContributedProjects('p-hidden')).map((p) => p.name)).toEqual(['Barn conversion']);
  });
});

// ─── 6. Vocabulary ──────────────────────────────────────────────────────

describe('the words', () => {
  const ROOT = path.resolve(__dirname, '..', '..', '..');
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  const files = ['app', 'features', 'components'].flatMap((dir) => sources(path.join(ROOT, dir)));

  it('never say "vendor": a Contributor is a Contributor', () => {
    expect(files.filter((file) => /vendor/i.test(fs.readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('never say someone was "tagged in" a project: they were added as a contributor', () => {
    expect(files.filter((file) => /tagged in/i.test(fs.readFileSync(file, 'utf8')))).toEqual([]);
  });
});
