//
// target: __tests__/components/UserAvatar.test.ts
// UserAvatar + Icons rendering — components/native/*.
//
// Since ONE-64 UserAvatar is an adapter: it maps the { username, avatarUrl }
// props older screens use onto the Avatar primitive, which owns the image,
// the initials fallback and the circle. Its own palette of fourteen hex
// swatches is gone (and with it UserAvatar.utils.test.ts, which pinned that
// palette); Avatar's behaviour is covered in __tests__/components/ui.

import React from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => require('../support/reactNativeDom'), { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

import UserAvatar from '../../components/native/UserAvatar';
import { Avatar, DEFAULT_AVATAR_SIZE } from '../../components/native/ui';
import {
  HomeIcon, SearchIcon, HeartIcon, CommentIcon, RepostIcon,
  BookmarkIcon, TrashIcon, BellIcon, UserIcon, CameraIcon,
  ShareIcon, PlusIcon, OneTagIcon, VerifiedIcon, FlagIcon,
  ReportIcon, StarIcon,
} from '../../components/native/Icons';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

type UserAvatarProps = {
  username: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  className?: string;
};

type AdapterElement = React.ReactElement<{
  uri?: string | null;
  name?: string | null;
  size?: number;
}>;

const render = (props: UserAvatarProps): AdapterElement =>
  (UserAvatar as unknown as (p: UserAvatarProps) => AdapterElement)(props);

// ─── 3. UserAvatar delegates to Avatar ──────────────────────────────────

describe('native UserAvatar — an adapter over Avatar', () => {
  it('renders the Avatar primitive, not an avatar of its own', () => {
    expect(render({ username: 'johndoe', avatarUrl: null }).type).toBe(Avatar);
  });

  it('maps avatarUrl to uri and username to name', () => {
    const el = render({ username: 'johndoe', avatarUrl: 'https://example.com/avatar.jpg' });
    expect(el.props.uri).toBe('https://example.com/avatar.jpg');
    expect(el.props.name).toBe('johndoe');
  });

  it('passes an explicit size through, and defaults to the primitive default', () => {
    [24, 32, 48, 64, 96].forEach(size => {
      expect(render({ username: 'johndoe', avatarUrl: null, size }).props.size).toBe(size);
    });
    expect(render({ username: 'johndoe', avatarUrl: null }).props.size).toBe(DEFAULT_AVATAR_SIZE);
    expect(DEFAULT_AVATAR_SIZE).toBe(40);
  });

  it('passes missing usernames and urls through for Avatar to handle', () => {
    ([null, undefined] as const).forEach(value => {
      const el = render({ username: value, avatarUrl: value });
      expect(el.props.name).toBe(value);
      expect(el.props.uri).toBe(value);
    });
  });

  it('ignores className, which the primitive does not take', () => {
    const el = render({ username: 'johndoe', avatarUrl: null, className: 'w-10 h-10' });
    expect(Object.keys(el.props).sort()).toEqual(['name', 'size', 'uri']);
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
