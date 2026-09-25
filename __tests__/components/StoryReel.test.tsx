/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/StoryReel.test.tsx
//
// OneSnaps as square cards (ONE-67): the reel renders portrait,
// square-cornered cards — never circles — with an ink border while unseen
// and a dimmed hairline once seen, and the first tile is "Your OneSnap".

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  // A horizontal FlatList, flattened: the leading node, then each item.
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListHeaderComponent?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      props.ListHeaderComponent ?? null,
      props.data.map((item, index) =>
        React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
      ),
    );
  return { ...shim, FlatList };
}, { virtual: true });
jest.mock('expo-image', () => {
  const React = require('react');
  const Image = (props: { source?: { uri: string }; style?: unknown }) =>
    React.createElement('img', {
      src: props.source?.uri,
      'data-opacity': String(require('../support/reactNativeDom').flattenStyle(props.style).opacity ?? 1),
    });
  return { Image };
}, { virtual: true });
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: (props: { colors: string[]; children?: React.ReactNode }) =>
      React.createElement('div', { 'data-gradient': props.colors.join(',') }, props.children),
  };
}, { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

const mockIsStoryViewed = jest.fn();
jest.mock('../../store/AppContext.native', () => ({
  useApp: () => ({ isStoryViewed: mockIsStoryViewed }),
}), { virtual: true });

const mockMyStories: { current: unknown[] } = { current: [] };
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: 'p-me' }),
}), { virtual: true });
jest.mock('../../features/stories', () => ({
  useMyStoriesQuery: () => ({ data: mockMyStories.current }),
}), { virtual: true });

import StoryReel, { REEL_CARD_WIDTH, REEL_CARD_HEIGHT, VIEWED_OPACITY } from '../../components/native/StoryReel';
import type { StoryGroup } from '../../components/native/StoryReel';
import StoryCreator from '../../components/native/StoryCreator';
import { gradientFor } from '../../lib/oneSnaps';
import { color, oneSnapGradientKeys, oneSnapGradients } from '../../theme/tokens';
import type { Story } from '../../types';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

// Viewed state is keyed by timestamp, so every fixture needs its own.
let clock = 0;
const story = (id: string, username: string, extra: Partial<Story> = {}): Story => ({
  id,
  userId: `u-${username}`,
  username,
  avatar: null,
  timestamp: new Date(Date.UTC(2026, 8, 24, 8, clock++)).toISOString(),
  imageUrl: `https://example.test/${id}.jpg`,
  ...extra,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  mockIsStoryViewed.mockReset();
  mockMyStories.current = [];
});

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

/** The card box inside a reel item: the first div of the item's button. */
const cardOf = (button: Element) => button.querySelector(':scope > div') as HTMLElement;

const itemButton = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

// ─── 3. Cards, never circles ────────────────────────────────────────────

describe('StoryReel — cards', () => {
  const groups: StoryGroup[] = [
    { username: 'ana', avatar: null, stories: [story('a1', 'ana')] },
    { username: 'ben', avatar: null, stories: [story('b1', 'ben')] },
  ];
  const all = groups.flatMap((g) => g.stories);

  it('renders each person as a square-cornered portrait card with the image', () => {
    mockIsStoryViewed.mockReturnValue(false);
    const el = mount(<StoryReel storyGroups={groups} allStories={all} onViewStories={jest.fn()} />);
    for (const name of ['ana', 'ben']) {
      const card = cardOf(itemButton(el, `${name}'s OneSnap, new`));
      expect(card.style.width).toBe(`${REEL_CARD_WIDTH}px`);
      expect(card.style.height).toBe(`${REEL_CARD_HEIGHT}px`);
      expect(REEL_CARD_HEIGHT).toBeGreaterThan(REEL_CARD_WIDTH);
      // Never a circle.
      expect(parseFloat(card.style.borderRadius || '0')).toBe(0);
      expect(card.querySelector('img')?.getAttribute('src')).toBe(`https://example.test/${name[0]}1.jpg`);
    }
  });

  it('gives an unseen card the 2pt ink border, and a seen one a dimmed hairline', () => {
    mockIsStoryViewed.mockImplementation((timestamp: string) => timestamp === groups[1].stories[0].timestamp);
    const el = mount(<StoryReel storyGroups={groups} allStories={all} onViewStories={jest.fn()} />);

    const unseen = cardOf(itemButton(el, "ana's OneSnap, new"));
    expect(unseen.style.borderWidth).toBe('2px');
    expect(rgb(unseen.style.borderColor)).toBe(rgb(color.text));
    expect(unseen.querySelector('img')?.getAttribute('data-opacity')).toBe('1');

    const seen = cardOf(itemButton(el, "ben's OneSnap, seen"));
    expect(seen.style.borderWidth).toBe('1px');
    expect(rgb(seen.style.borderColor)).toBe(rgb(color.border));
    expect(seen.querySelector('img')?.getAttribute('data-opacity')).toBe(String(VIEWED_OPACITY));
  });

  it('puts unseen people first', () => {
    mockIsStoryViewed.mockImplementation((timestamp: string) => timestamp === groups[0].stories[0].timestamp);
    const el = mount(<StoryReel storyGroups={groups} allStories={all} onViewStories={jest.fn()} />);
    const labels = Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(["ben's OneSnap, new", "ana's OneSnap, seen"]);
  });

  it('shows a text OneSnap on its gradient', () => {
    mockIsStoryViewed.mockReturnValue(false);
    const text = story('t1', 'cy', { imageUrl: undefined, content: 'hello' });
    const el = mount(
      <StoryReel storyGroups={[{ username: 'cy', avatar: null, stories: [text] }]} allStories={[text]} onViewStories={jest.fn()} />,
    );
    const face = el.querySelector('[data-gradient]') as HTMLElement;
    expect(face.getAttribute('data-gradient')).toBe(gradientFor(text).join(','));
    expect(face.textContent).toBe('hello');
  });

  it('draws a text OneSnap on the gradient its author picked', () => {
    mockIsStoryViewed.mockReturnValue(false);
    const third = oneSnapGradientKeys[2];
    const text = story('t2', 'dee', { imageUrl: undefined, content: 'picked', background: third });
    const el = mount(
      <StoryReel storyGroups={[{ username: 'dee', avatar: null, stories: [text] }]} allStories={[text]} onViewStories={jest.fn()} />,
    );
    const face = el.querySelector('[data-gradient]') as HTMLElement;
    expect(face.getAttribute('data-gradient')).toBe(oneSnapGradients[third].join(','));
  });

  it('opens the viewer at that person\'s first OneSnap', () => {
    mockIsStoryViewed.mockReturnValue(false);
    const onViewStories = jest.fn();
    const el = mount(<StoryReel storyGroups={groups} allStories={all} onViewStories={onViewStories} />);
    act(() => itemButton(el, "ben's OneSnap, new").click());
    expect(onViewStories).toHaveBeenCalledWith(all, 1);
  });

  it('renders a leading node first', () => {
    mockIsStoryViewed.mockReturnValue(false);
    const el = mount(
      <StoryReel storyGroups={groups} allStories={all} onViewStories={jest.fn()} leading={<span data-leading="true" />} />,
    );
    const list = el.querySelector('[data-list]')!;
    expect(list.firstElementChild?.querySelector('[data-leading]')).not.toBeNull();
  });
});

// ─── 4. "Your OneSnap" ──────────────────────────────────────────────────

describe('StoryCreator — the "Your OneSnap" tile', () => {
  it('with nothing live, shows the + tile labelled "Your OneSnap", which opens create', () => {
    const onAddStory = jest.fn();
    const onViewStories = jest.fn();
    const el = mount(<StoryCreator onAddStory={onAddStory} onViewStories={onViewStories} />);

    const tile = itemButton(el, 'Add a OneSnap');
    expect(tile).not.toBeNull();
    expect(tile.textContent).toContain('Your OneSnap');
    const card = cardOf(tile);
    expect(card.style.width).toBe(`${REEL_CARD_WIDTH}px`);
    expect(card.querySelector('img')).toBeNull();

    act(() => tile.click());
    expect(onAddStory).toHaveBeenCalledTimes(1);
    expect(onViewStories).not.toHaveBeenCalled();
  });

  it('with a live OneSnap, shows its image undimmed with a + badge, and views it', () => {
    mockMyStories.current = [story('m1', 'me')];
    const onAddStory = jest.fn();
    const onViewStories = jest.fn();
    const el = mount(<StoryCreator onAddStory={onAddStory} onViewStories={onViewStories} />);

    const tile = itemButton(el, 'View your OneSnap');
    const card = cardOf(tile);
    expect(card.querySelector('img')?.getAttribute('data-opacity')).toBe('1');
    expect(card.style.borderWidth).toBe('1px');

    act(() => tile.click());
    expect(onViewStories).toHaveBeenCalledWith(mockMyStories.current, 0);
    expect(onAddStory).not.toHaveBeenCalled();
  });
});
