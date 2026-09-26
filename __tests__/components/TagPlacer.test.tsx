/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/TagPlacer.test.tsx
//
// Placing tags on the composer's photo (ONE-46), mounted. The picture's
// content rect is fixed — jsdom lays nothing out — as a 16:9 photo drawn
// 400×225 at the top of its frame:
//
//   * a tap places a tag at the tapped point, in percent of the picture;
//   * a tap in the letterbox clamps to the picture's edge;
//   * dragging a tag moves it, and the new position is what is reported;
//   * the list counts the tags and removes one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => require('../support/reactNativeDom'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));
jest.mock('expo-image', () => require('../support/expoImageStub'));

const mockRect = { x: 0, y: 0, width: 400, height: 225 };
jest.mock('../../components/native/EmbeddedTags', () => ({
  __esModule: true,
  default: () => null,
  useImageContentRect: () => ({ contentRect: mockRect, onLayout: () => {}, onLoad: () => {} }),
}));

import { PanResponder } from 'react-native';
import TagPlacer from '../../components/native/TagPlacer';
import type { DraftTag } from '../../lib/screens/composeTags';

const TAGS: DraftTag[] = [
  { key: 'a', xPct: 50, yPct: 50, destination: { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: null } },
  { key: 'b', xPct: 10, yPct: 20, destination: null },
];

const handlers = { onPlace: jest.fn(), onMove: jest.fn(), onRemove: jest.fn(), onChoose: jest.fn() };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(tags: DraftTag[] = TAGS): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<TagPlacer uri="file:///photo.jpg" aspectRatio={16 / 9} tags={tags} {...handlers} />));
  return container;
}

function tapAt(el: HTMLElement, x: number, y: number) {
  const surface = el.querySelector('[data-testid="tag-placer-surface"]') as HTMLElement;
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'locationX', { value: x });
  Object.defineProperty(event, 'locationY', { value: y });
  act(() => {
    surface.dispatchEvent(event);
  });
}

beforeEach(() => {
  Object.values(handlers).forEach((h) => h.mockClear());
  (PanResponder.create as jest.Mock).mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('placing', () => {
  it('places a tag where the photo is tapped, in percent of the picture', () => {
    const el = mount([]);
    tapAt(el, 200, 112.5);
    expect(handlers.onPlace).toHaveBeenCalledWith(50, 50);
  });

  it('clamps a tap outside the picture to its edge', () => {
    const el = mount([]);
    tapAt(el, 200, 300);
    expect(handlers.onPlace).toHaveBeenCalledWith(50, 100);
  });

  it('tells the author to tap while there are no tags', () => {
    const el = mount([]);
    expect(el.textContent).toContain('TAP THE PHOTO TO TAG');
    expect(el.textContent).toContain('0 / 10 TAGGED');
  });
});

describe('placed tags', () => {
  it('draws each at its position, and counts them', () => {
    const el = mount();
    const a = el.querySelector('[data-testid="draft-tag-a"]') as HTMLElement;
    expect(parseFloat(a.style.left) + 22).toBe(200);
    expect(parseFloat(a.style.top) + 22).toBe(112.5);
    expect(el.textContent).toContain('2 / 10 TAGGED');
  });

  it('moves a tag by dragging it, reporting the new position', () => {
    mount();
    // The first marker's responder: tag "a" at (200, 112.5), dragged 100 right.
    const config = (PanResponder.create as jest.Mock).mock.calls[0][0];
    act(() => config.onPanResponderRelease({}, { dx: 100, dy: 0 }));
    expect(handlers.onMove).toHaveBeenCalledWith('a', 75, 50);
  });

  it('removes a tag from the list', () => {
    const el = mount();
    act(() => (el.querySelector('button[aria-label="Remove tag 1"]') as HTMLButtonElement).click());
    expect(handlers.onRemove).toHaveBeenCalledWith('a');
  });

  it('reopens the picker for a tag with nowhere to point', () => {
    const el = mount();
    act(() => (el.querySelector('button[aria-label="Tag 2: choose what it points to"]') as HTMLButtonElement).click());
    expect(handlers.onChoose).toHaveBeenCalledWith('b');
  });
});
