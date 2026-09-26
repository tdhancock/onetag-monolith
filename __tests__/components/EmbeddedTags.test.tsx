/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/EmbeddedTags.test.tsx
//
// Embedded Tags over a post's image (ONE-45), mounted. The scan mutation,
// the acting profile and the router are faked:
//
//   * each tag renders at its stored position over the picture's content;
//   * no marker shows while the picture is unmeasured, but the badge does;
//   * a tap records exactly one scan and opens that tag's card; rendering
//     records none;
//   * two tags 20pt apart are each tappable, and open their own cards;
//   * the composer's preview draws the same markers and records nothing.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => require('../support/reactNativeDom'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (r: string) => mockPush(r) } }));

jest.mock('../../features/profiles', () => ({ useCurrentProfile: () => ({ profileId: 'p-viewer' }) }));

const mockRecordScan = jest.fn();
jest.mock('../../features/tags', () => ({ useRecordScan: () => ({ mutate: mockRecordScan }) }));

import EmbeddedTags from '../../components/native/EmbeddedTags';
import { TAG_HIT_SIZE } from '../../lib/screens/embeddedTags';
import type { EmbeddedTag } from '../../types';

const TAGS: EmbeddedTag[] = [
  { id: 't-lamp', xPct: 50, yPct: 50, destination: { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: null } },
  { id: 't-loft', xPct: 55, yPct: 50, destination: { kind: 'project', projectId: 'pj-1', name: 'Loft', imageUrl: null } },
  {
    id: 't-studio',
    xPct: 0,
    yPct: 100,
    destination: { kind: 'profile', profileId: 'p-1', username: 'studio', profileType: 'business', name: 'Studio', imageUrl: 'a.jpg' },
  },
];

// A 2:1 picture letterboxed in a 400×500 view: drawn 400×200 at y = 150.
const RECT = { x: 0, y: 150, width: 400, height: 200 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(props: Partial<React.ComponentProps<typeof EmbeddedTags>> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EmbeddedTags tags={TAGS} contentRect={RECT} {...props} />));
  return container;
}

const marker = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="embedded-tag-${id}"]`) as HTMLButtonElement;
const markers = (el: HTMLElement) => el.querySelectorAll('[data-testid^="embedded-tag-"]');

beforeEach(() => {
  mockPush.mockClear();
  mockRecordScan.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('placement', () => {
  it('draws each tag centred on its stored position over the picture, not the letterbox', () => {
    const el = mount();
    expect(markers(el)).toHaveLength(3);

    const centre = (id: string) => {
      const style = marker(el, id).style;
      return { x: parseFloat(style.left) + TAG_HIT_SIZE / 2, y: parseFloat(style.top) + TAG_HIT_SIZE / 2 };
    };
    expect(centre('t-lamp')).toEqual({ x: 200, y: 250 });
    expect(centre('t-loft')).toEqual({ x: 220, y: 250 });
    // The picture's bottom-left corner, at the top of the bottom padding.
    expect(centre('t-studio')).toEqual({ x: 0, y: 350 });
  });

  it('draws no marker while the picture loads, but still shows the count', () => {
    const el = mount({ contentRect: null });
    expect(markers(el)).toHaveLength(0);
    expect(el.textContent).toContain('3 TAGGED · TAP TO SEE');
  });

  it('renders nothing on media without tags', () => {
    const el = mount({ tags: [] });
    expect(el.textContent).toBe('');
  });
});

describe('tapping', () => {
  it('records nothing on render', () => {
    mount();
    expect(mockRecordScan).not.toHaveBeenCalled();
  });

  it('records exactly one scan and opens the card with the name, type and a way on', () => {
    const el = mount();
    act(() => marker(el, 't-lamp').click());

    expect(mockRecordScan).toHaveBeenCalledTimes(1);
    expect(mockRecordScan).toHaveBeenCalledWith({ tagId: 't-lamp', scannerProfileId: 'p-viewer' });
    expect(el.textContent).toContain('Lamp');
    expect(el.textContent).toContain('Product');

    const view = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'View')!;
    act(() => view.click());
    expect(mockPush).toHaveBeenCalledWith('/product/pd-1');
  });

  it('opens the right card for each of two tags 20pt apart', () => {
    const el = mount();
    act(() => marker(el, 't-loft').click());
    expect(el.textContent).toContain('Loft');
    expect(el.textContent).not.toContain('Lamp');
    expect(mockRecordScan).toHaveBeenLastCalledWith({ tagId: 't-loft', scannerProfileId: 'p-viewer' });
  });

  it('announces each tag by its destination\'s name and type', () => {
    const el = mount();
    expect(marker(el, 't-studio').getAttribute('aria-label')).toBe('Tagged Business Profile: Studio');
  });
});

describe('the composer preview', () => {
  it('draws the same markers and records nothing when tapped', () => {
    const el = mount({ interactive: false });
    expect(markers(el)).toHaveLength(3);
    act(() => marker(el, 't-lamp').click());
    expect(mockRecordScan).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('Product');
  });
});
