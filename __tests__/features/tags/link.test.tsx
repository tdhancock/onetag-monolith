/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/tags/link.test.tsx
//
// Link this tag (ONE-139), app/tags/[id]/link.tsx, mounted over the real tags
// feature and a real query client — only the Supabase client, the router, the
// acting profile and what the account owns are faked:
//
//   * it offers only what the account owns, as the create flow does;
//   * choosing a destination names the tag after it, unless the owner typed
//     a name, and Link writes that destination and name, once;
//   * on success it replaces itself with the destination's screen;
//   * a failed link says so and keeps the choice to retry;
//   * a tag that is already linked, or isn't the profile's, says so;
//   * a New project is made right here and the tag linked to it (ONE-142),
//     Part of starting where the last tag went, and a failed link retried
//     without making a second project.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const Switch = (props: { value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel?: string }) =>
    React.createElement('button', {
      role: 'switch',
      'aria-checked': props.value,
      'aria-label': props.accessibilityLabel,
      onClick: () => props.onValueChange(!props.value),
    });
  return { ...shim, Switch, ScrollView: box, KeyboardAvoidingView: box, Platform: { OS: 'ios' } };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../../support/expoImageStub'));

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  Stack: { Screen: () => null },
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const ANA = { id: 'p-ana', username: 'ana', name: 'Ana Reyes', profileType: 'individual', profilePicture: null };
const STUDIO = { id: 'p-studio', username: 'ana_studio', name: 'Ana Studio', profileType: 'business', profilePicture: null };
jest.mock('../../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: 'p-ana', authUserId: 'auth-1' }),
  useMyProfilesQuery: () => ({ data: [ANA, STUDIO] }),
  useProfilePostsQuery: () => ({ data: [], isLoading: false }),
}));
jest.mock('../../../features/products', () => ({
  useBusinessProductsQuery: (businessProfileId?: string) => ({
    data: businessProfileId === 'p-studio' ? [{ id: 'pd-filter', name: 'Filter', category: null, imageUrl: null }] : undefined,
    isLoading: false,
  }),
}));
const mockOwnedProjects: Record<string, unknown>[] = [];
const mockCreateProject = jest.fn();
jest.mock('../../../features/projects', () => ({
  useOwnedProjectsQuery: (ownerProfileId?: string) => ({
    data: ownerProfileId === 'p-ana' ? mockOwnedProjects : ownerProfileId ? [] : undefined,
    isLoading: false,
  }),
  useCreateProject: () => ({ mutateAsync: (...args: unknown[]) => mockCreateProject(...args), isPending: false }),
}));
jest.mock('../../../features/interests', () => ({ useInterestsQuery: () => ({ data: [], isLoading: false }) }));
jest.mock('../../../services/mediaPicker', () => ({ pickImageFromLibrary: jest.fn() }));

// ─── The database ───────────────────────────────────────────────────────

const tagRow = (overrides: Record<string, unknown>) => ({
  id: 't-blank',
  owner_profile_id: 'p-ana',
  tag_type: 'physical',
  format: 'qr',
  name: null,
  note: null,
  short_code: 'BLANK234',
  active: true,
  created_at: '2026-10-06T12:00:00Z',
  dest_profile_id: null,
  dest_product_id: null,
  dest_project_id: null,
  dest_post_id: null,
  ...overrides,
});

const mockTags: Record<string, unknown>[] = [];
const mockUpdates: { payload: Record<string, unknown>; id: unknown }[] = [];
let mockUpdateFails = false;

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: () => {
      const op: { payload?: Record<string, unknown>; id?: unknown } = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        update: (payload: Record<string, unknown>) => {
          op.payload = payload;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          if (column === 'id') op.id = value;
          return chain;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          if (!op.payload) return Promise.resolve({ data: mockTags, error: null }).then(resolve, reject);
          mockUpdates.push({ payload: op.payload, id: op.id });
          if (mockUpdateFails) return Promise.resolve({ data: null, error: new Error('offline') }).then(resolve, reject);
          const linked = {
            ...mockTags.find((tag) => tag.id === op.id),
            ...op.payload,
            dest_project: { id: 'pj-furnace', name: 'Furnace' },
          };
          return Promise.resolve({ data: [linked], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

import LinkTagScreen from '../../../app/tags/[id]/link';
import { LINK_TAG_FAILED } from '../../../lib/screens/tags';
import { forgetLinkedProject, rememberLinkedProject } from '../../../lib/linkParentMemory';

const FURNACE = { id: 'pj-furnace', ownerProfileId: 'p-ana', name: 'Furnace', projectType: null, coverUrl: null, isPublic: false, parentProjectId: null };
const HOME = { id: 'pj-home', ownerProfileId: 'p-ana', name: 'Home', projectType: null, coverUrl: null, isPublic: false, parentProjectId: null };

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
        <LinkTagScreen />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const nameField = (el: HTMLElement) => el.querySelector('input[aria-label="Name"]') as HTMLInputElement;
const click = async (b: HTMLElement | undefined | null) => {
  await act(async () => (b as HTMLElement).click());
  await settle();
};
function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockParams.current = { id: 't-blank' };
  mockTags.length = 0;
  mockTags.push(tagRow({}));
  mockUpdates.length = 0;
  mockUpdateFails = false;
  mockOwnedProjects.length = 0;
  mockOwnedProjects.push({ ...FURNACE });
  mockCreateProject.mockReset().mockResolvedValue('pj-new');
  forgetLinkedProject();
  [mockRouter.back, mockRouter.replace, mockRouter.push, mockToast].forEach((m) => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

describe('linking a blank tag', () => {
  it('shows its code, and offers only what the account owns', async () => {
    const el = await mount();
    expect(el.textContent).toContain('Physical · BLANK234');
    expect(byLabel(el, 'Ana Reyes')).not.toBeNull();
    expect(byLabel(el, 'Ana Studio')).not.toBeNull();
    expect(byLabel(el, 'Filter')).not.toBeNull();
    expect(byLabel(el, 'Furnace')).not.toBeNull();
  });

  it('will not link until a destination is chosen', async () => {
    const el = await mount();
    expect(byText(el, 'Link tag')!.disabled).toBe(true);
    await click(byLabel(el, 'Furnace'));
    expect(byText(el, 'Link tag')!.disabled).toBe(false);
  });

  it('names the tag after what it points to, writes the destination once, and opens it', async () => {
    const el = await mount();
    await click(byLabel(el, 'Furnace'));
    expect(nameField(el).value).toBe('Furnace');
    await click(byText(el, 'Link tag'));
    expect(mockUpdates).toEqual([{ id: 't-blank', payload: { dest_project_id: 'pj-furnace', name: 'Furnace' } }]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/project/pj-furnace');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('keeps a name the owner typed, whatever they choose', async () => {
    const el = await mount();
    typeInto(nameField(el), 'Basement furnace');
    await click(byLabel(el, 'Furnace'));
    expect(nameField(el).value).toBe('Basement furnace');
    await click(byText(el, 'Link tag'));
    expect(mockUpdates[0]!.payload.name).toBe('Basement furnace');
  });

  it('keeps the name a blank tag was already given', async () => {
    mockTags[0] = tagRow({ name: 'Spare' });
    const el = await mount();
    await click(byLabel(el, 'Furnace'));
    expect(nameField(el).value).toBe('Spare');
  });

  it('says so when linking fails, and keeps the choice to try again', async () => {
    mockUpdateFails = true;
    const el = await mount();
    await click(byLabel(el, 'Furnace'));
    await click(byText(el, 'Link tag'));
    expect(mockToast).toHaveBeenCalledWith(LINK_TAG_FAILED, 'error');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(byLabel(el, 'Furnace, selected')).not.toBeNull();

    mockUpdateFails = false;
    await click(byText(el, 'Link tag'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/project/pj-furnace');
  });
});

describe('a tag that can\'t be linked here', () => {
  it('says a linked tag never changes, with the way to the tag', async () => {
    mockTags[0] = tagRow({ dest_project_id: 'pj-furnace', dest_project: { id: 'pj-furnace', name: 'Furnace' } });
    const el = await mount();
    expect(el.textContent).toContain('This tag is already linked');
    expect(byText(el, 'Link tag')).toBeUndefined();
    await click(byText(el, 'Open the tag'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/tags/t-blank');
  });

  it("says so when the profile owns no such tag", async () => {
    mockParams.current = { id: 't-someone-elses' };
    const el = await mount();
    expect(el.textContent).toContain('Tag not found');
  });
});

describe('a new project, made while linking (ONE-142)', () => {
  beforeEach(() => {
    mockOwnedProjects.length = 0;
    mockOwnedProjects.push({ ...HOME });
  });

  it('makes the project inside the one chosen, links the tag to it, and opens it', async () => {
    const el = await mount();
    await click(byText(el, 'New project'));
    typeInto(el.querySelector('input[aria-label="Name"]') as HTMLInputElement, 'Furnace');
    await click(byLabel(el, 'Part of: None'));
    await click(byText(el, 'Home'));
    await click(byText(el, 'Make project and link tag'));

    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockCreateProject.mock.calls[0]![0]).toMatchObject({
      ownerProfileId: 'p-ana',
      fields: { name: 'Furnace', parentProjectId: 'pj-home' },
    });
    expect(mockUpdates).toEqual([{ id: 't-blank', payload: { dest_project_id: 'pj-new', name: 'Furnace' } }]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/project/pj-new');
  });

  it('starts the next one inside the project the last tag went into', async () => {
    rememberLinkedProject({ id: 'pj-furnace', parentProjectId: 'pj-home' });
    const el = await mount();
    await click(byText(el, 'New project'));
    expect(byLabel(el, 'Part of: Home')).not.toBeNull();
  });

  it('starts inside a top-level project the last tag went to, so the walk never picks Home twice', async () => {
    const el = await mount();
    await click(byLabel(el, 'Home'));
    await click(byText(el, 'Link tag'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/project/pj-furnace');
    act(() => root!.unmount());
    root = null;
    container?.remove();
    const next = await mount();
    await click(byText(next, 'New project'));
    expect(byLabel(next, 'Part of: Home')).not.toBeNull();
  });

  it('retries a failed link without making a second project', async () => {
    mockUpdateFails = true;
    const el = await mount();
    await click(byText(el, 'New project'));
    typeInto(el.querySelector('input[aria-label="Name"]') as HTMLInputElement, 'Water heater');
    await click(byText(el, 'Make project and link tag'));
    expect(mockToast).toHaveBeenCalledWith(LINK_TAG_FAILED, 'error');
    expect(mockRouter.replace).not.toHaveBeenCalled();

    mockUpdateFails = false;
    await click(byText(el, 'Link tag'));
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/project/pj-new');
  });

  it('goes back to the list without making anything', async () => {
    const el = await mount();
    await click(byText(el, 'New project'));
    await click(byText(el, 'Back to the list'));
    expect(byText(el, 'Link tag')).toBeDefined();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});
