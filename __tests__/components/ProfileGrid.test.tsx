/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/ProfileGrid.test.tsx
 * A profile grid tile — components/native/ProfileGrid.
 *
 * The tile drew `media_preview_url`, the 50px blur-up render meant only as a
 * placeholder, stretched across a ~130pt square: every photo in the grid
 * looked zoomed in and soft. It draws the photo, square, with the preview
 * only as its placeholder.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  ...require('../support/reactNativeDom'),
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });
jest.mock('expo-image', () => {
  const React = require('react');
  return {
    Image: (props: { source?: { uri?: string }; placeholder?: { uri?: string }; contentFit?: string }) =>
      React.createElement('img', {
        src: props.source?.uri,
        'data-placeholder': props.placeholder?.uri,
        'data-fit': props.contentFit,
      }),
  };
}, { virtual: true });

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { GridTile } from '../../components/native/ProfileGrid';
import { profileGridTileSize } from '../../lib/screens/profile';
import type { Post } from '../../types';

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
});

const photoPost: Post = {
  id: 'p1',
  username: 'me',
  avatar: null,
  content: '',
  media: 'https://x.supabase.co/storage/v1/object/public/posts/p1.jpg',
  media_preview_url: 'https://x.supabase.co/storage/v1/render/image/public/posts/p1.jpg?width=50',
  media_type: 'image',
  likes: 0,
  reposts: 0,
  replies: 0,
};

describe('GridTile', () => {
  it('draws the full photo, with the 50px preview only as its placeholder', () => {
    const img = mount(<GridTile post={photoPost} index={0} onPress={jest.fn()} />).querySelector('img')!;
    expect(img.getAttribute('src')).toBe(photoPost.media);
    expect(img.getAttribute('data-placeholder')).toBe(photoPost.media_preview_url);
    expect(img.getAttribute('data-fit')).toBe('cover');
  });

  it('is a square a third of the screen wide', () => {
    const tile = mount(<GridTile post={photoPost} index={0} onPress={jest.fn()} />).querySelector('button')!;
    const side = `${profileGridTileSize(390)}px`;
    expect(tile.style.width).toBe(side);
    expect(tile.style.height).toBe(side);
  });
});
