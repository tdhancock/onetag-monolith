
//
// target: __tests__/components/UserAvatar.test.ts
// UserAvatar + Icons rendering — components/native/*.
//
// Repointed from the deleted web fork. The fork's avatar was sized by
// Tailwind `className` ("w-10 h-10") and rendered an <img>; the native twin
// takes a numeric `size` and renders either an expo-image <Image> or a
// <View>/<Text> initials badge. The assertions follow the native contract.

import React from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => require('../support/reactNativeDom'), { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

import UserAvatar from '../../components/native/UserAvatar';
import {
  HomeIcon, SearchIcon, HeartIcon, CommentIcon, RepostIcon,
  BookmarkIcon, TrashIcon, BellIcon, UserIcon, CameraIcon,
  ShareIcon, PlusIcon, OneTagIcon, VerifiedIcon, FlagIcon,
  ReportIcon, StarIcon,
} from '../../components/native/Icons';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type AvatarProps = {
  username: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  className?: string;
};

type AvatarElement = React.ReactElement<{
  style: Record<string, unknown>;
  source?: { uri: string };
  contentFit?: string;
  transition?: number;
  children?: React.ReactElement<{ children?: unknown; style?: Record<string, unknown> }>;
}>;

const render = (props: AvatarProps): AvatarElement =>
  (UserAvatar as unknown as (p: AvatarProps) => AvatarElement)(props);

// ─── 3. UserAvatar — image branch ───────────────────────────────────────

describe('native UserAvatar — with an avatarUrl', () => {
  it('renders the remote image with the url as its source', () => {
    const el = render({
      username: 'johndoe',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    expect(el.props.source).toEqual({ uri: 'https://example.com/avatar.jpg' });
  });

  it('sizes the image as a circle at the default 40px', () => {
    const el = render({ username: 'johndoe', avatarUrl: 'https://x/a.jpg' });
    expect(el.props.style).toMatchObject({
      width: 40,
      height: 40,
      borderRadius: 20,
    });
  });

  it('keeps the circle at any explicit size', () => {
    [24, 32, 48, 64, 96].forEach(size => {
      const el = render({ username: 'johndoe', avatarUrl: 'https://x/a.jpg', size });
      expect(el.props.style).toMatchObject({
        width: size,
        height: size,
        borderRadius: size / 2,
      });
    });
  });

  it('covers the frame rather than letterboxing, and fades in', () => {
    // A stretched or letterboxed avatar is the visible failure here, so
    // the contentFit is part of the contract, not an incidental prop.
    const el = render({ username: 'johndoe', avatarUrl: 'https://x/a.jpg' });
    expect(el.props.contentFit).toBe('cover');
    expect(el.props.transition).toBe(200);
  });

  it('prefers the image over the initials badge even with no username', () => {
    const el = render({ username: null, avatarUrl: 'https://x/a.jpg' });
    expect(el.props.source).toEqual({ uri: 'https://x/a.jpg' });
    expect(el.props.children).toBeUndefined();
  });
});

// ─── 4. UserAvatar — initials branch ────────────────────────────────────

describe('native UserAvatar — without an avatarUrl', () => {
  it('renders an initials badge instead of an image', () => {
    const el = render({ username: 'alice', avatarUrl: null });
    expect(el.props.source).toBeUndefined();
    expect(el.props.children?.props.children).toBe('A');
  });

  it('centers the initial in a coloured circle', () => {
    const el = render({ username: 'alice', avatarUrl: null, size: 60 });
    expect(el.props.style).toMatchObject({
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(typeof el.props.style.backgroundColor).toBe('string');
  });

  it('scales the glyph to 40% of the avatar size', () => {
    [20, 40, 80].forEach(size => {
      const el = render({ username: 'alice', avatarUrl: null, size });
      expect(el.props.children?.props.style).toMatchObject({ fontSize: size * 0.4 });
    });
  });

  it('handles null, undefined and empty usernames without throwing', () => {
    ([null, undefined, ''] as const).forEach(username => {
      expect(() => render({ username, avatarUrl: null })).not.toThrow();
      const el = render({ username, avatarUrl: null });
      expect(el.props.children?.props.children).toBe('?');
    });
  });

  it('is stable across repeated renders of the same username', () => {
    const a = render({ username: 'size-test', avatarUrl: null });
    const b = render({ username: 'size-test', avatarUrl: null });
    expect(a.props.style.backgroundColor).toBe(b.props.style.backgroundColor);
  });
});

// ─── 5. Icons smoke coverage ────────────────────────────────────────────

describe('native Icons — used alongside UserAvatar', () => {
  const iconComponents = [
    ['HomeIcon', HomeIcon],
    ['SearchIcon', SearchIcon],
    ['HeartIcon', HeartIcon],
    ['CommentIcon', CommentIcon],
    ['RepostIcon', RepostIcon],
    ['BookmarkIcon', BookmarkIcon],
    ['TrashIcon', TrashIcon],
    ['BellIcon', BellIcon],
    ['UserIcon', UserIcon],
    ['CameraIcon', CameraIcon],
    ['ShareIcon', ShareIcon],
    ['PlusIcon', PlusIcon],
    ['OneTagIcon', OneTagIcon],
    ['VerifiedIcon', VerifiedIcon],
    ['FlagIcon', FlagIcon],
    ['ReportIcon', ReportIcon],
    ['StarIcon', StarIcon],
  ] as const;

  iconComponents.forEach(([name, Component]) => {
    it(`${name} builds an Svg element when invoked`, () => {
      const el = (Component as unknown as (p: Record<string, unknown>) => React.ReactElement<
        Record<string, unknown>
      >)({});
      expect(el).toBeDefined();
      expect(typeof el.props.viewBox).toBe('string');
    });
  });

  it('HeartIcon fill follows the liked prop', () => {
    const toSvg = (props: Record<string, unknown>) =>
      (HeartIcon as unknown as (p: Record<string, unknown>) => React.ReactElement<
        Record<string, unknown>
      >)(props);
    expect(toSvg({ color: '#f00', liked: true }).props.fill).toBe('#f00');
    expect(toSvg({ color: '#f00', liked: false }).props.fill).toBe('none');
  });

  it('BookmarkIcon fill follows the saved prop', () => {
    const toSvg = (props: Record<string, unknown>) =>
      (BookmarkIcon as unknown as (p: Record<string, unknown>) => React.ReactElement<
        Record<string, unknown>
      >)(props);
    expect(toSvg({ color: '#0f0', saved: true }).props.fill).toBe('#0f0');
    expect(toSvg({ color: '#0f0', saved: false }).props.fill).toBe('none');
  });

  it('OneTagIcon defaults to 32px and honours an explicit size', () => {
    const toSvg = (props: Record<string, unknown>) =>
      (OneTagIcon as unknown as (p: Record<string, unknown>) => React.ReactElement<
        Record<string, unknown>
      >)(props);
    expect(toSvg({}).props.width).toBe(32);
    expect(toSvg({ size: 10 }).props.width).toBe(10);
  });
});
