/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/EditPostScreen.test.tsx
//
// Edit post (ONE-73): Save waits for the server. It used to fire the update,
// toast "Post updated." and close in the same tick, so a save the server
// refused looked exactly like one it accepted and the edit was lost.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return { ...shim, ScrollView: box, Platform: { OS: 'ios' } };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'post-1' }),
  Stack: { Screen: () => null },
}));

const mockToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', name: 'Me', profilePicture: null } }),
}));

const mockMutateAsync = jest.fn();
const mockFetchPost = jest.fn();
jest.mock('../../features/posts', () => ({
  useUpdatePost: () => ({ mutateAsync: mockMutateAsync }),
  fetchPostById: (id: string) => mockFetchPost(id),
}));

import EditPostScreen from '../../app/edit-post';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<EditPostScreen />); });
  return container;
}

beforeEach(() => {
  mockBack.mockClear();
  mockToast.mockClear();
  mockMutateAsync.mockReset();
  mockFetchPost.mockResolvedValue({ id: 'post-1', content: 'first draft', media_type: 'text' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  (console.error as jest.Mock).mockRestore();
});

const input = (el: HTMLElement) => el.querySelector('input[aria-label="Post text"]') as HTMLInputElement;
const saveButton = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement;

function type(el: HTMLElement, text: string) {
  const field = input(el);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Edit post — saving', () => {
  it('keeps Save disabled until the text changes', async () => {
    const el = await mount();
    expect(input(el).value).toBe('first draft');
    expect(saveButton(el).disabled).toBe(true);
    type(el, 'second draft');
    expect(saveButton(el).disabled).toBe(false);
  });

  it('closes, and says so, once the server has saved it', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'post-1', content: 'second draft' });
    const el = await mount();
    type(el, 'second draft');
    await act(async () => { saveButton(el).click(); });

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'post-1', content: 'second draft' }));
    expect(mockToast).toHaveBeenCalledWith('Post updated.', 'success');
    expect(mockBack).toHaveBeenCalled();
  });

  it('stays open with the edit intact when the save fails', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Could not save that post.'));
    const el = await mount();
    type(el, 'second draft');
    await act(async () => { saveButton(el).click(); });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Failed to update post.', 'error');
    expect(mockToast).not.toHaveBeenCalledWith('Post updated.', 'success');
    expect(input(el).value).toBe('second draft');
  });
});
