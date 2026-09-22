/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/LoadingStates.test.tsx
 *
 * Loading-state UI, covering components/native/PostSkeleton.
 *
 * Repointed from the deleted web fork. The two skeletons are not the same
 * component in different clothes:
 *
 *   - the fork rendered <div>s and switched a Tailwind `animate-pulse`
 *     class for `filter blur-sm` on a 750ms timer;
 *   - the native twin renders react-native <Animated.View> shimmer bars
 *     driven by a looped opacity animation, with no phase transition.
 *
 * So the pulse/blur assertions are gone and the animation lifecycle takes
 * their place. The fork's LoginScreen spinner harness went with the fork —
 * that screen has no native twin.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 1. Mock react-native ────────────────────────────────────────────────
// PostSkeleton needs View plus the Animated API (Value / loop / sequence /
// timing / View). The shared DOM-passthrough shim renders to DOM nodes so
// react-dom can mount the real component, and exposes the loop handle so
// the test can assert that the animation is started on mount and stopped
// on unmount.

jest.mock('react-native', () => require('../support/reactNativeDom'), { virtual: true });

// ─── 2. Imports ─────────────────────────────────────────────────────────
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Animated } from 'react-native';
import PostSkeleton from '../../components/native/PostSkeleton';

const animationHandles = (Animated as unknown as {
  __handles: { start: jest.Mock; stop: jest.Mock };
}).__handles;

// ─── 3. Helpers ─────────────────────────────────────────────────────────

interface MountHandle {
  root: Root;
  container: HTMLDivElement;
}

function mount(element: React.ReactElement): MountHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { root, container };
}

function unmount(handle: MountHandle): void {
  act(() => {
    handle.root.unmount();
  });
  handle.container.remove();
}

const shimmerBars = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div[data-animated="true"]'));

// The bar geometry PostSkeleton lays out, in document order: avatar, the
// two header lines, two body lines, the media block, then three action
// placeholders.
const EXPECTED_BAR_COUNT = 9;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── 4. Shimmer structure ───────────────────────────────────────────────

describe('Loading states — skeleton shimmer structure', () => {
  it('renders one shimmer bar per placeholder slot', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      expect(shimmerBars(handle.container)).toHaveLength(EXPECTED_BAR_COUNT);
    } finally {
      unmount(handle);
    }
  });

  it('paints every bar with the shared shimmer background and radius', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const bars = shimmerBars(handle.container);
      expect(bars.length).toBeGreaterThan(0);
      bars.forEach(bar => {
        // #374151 — jsdom normalises the hex to rgb().
        expect((bar as HTMLElement).style.backgroundColor).toBe('rgb(55, 65, 81)');
      });
    } finally {
      unmount(handle);
    }
  });

  it('gives each bar an animated opacity driver', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const bars = shimmerBars(handle.container);
      bars.forEach(bar => {
        expect(bar.getAttribute('data-has-opacity-driver')).toBe('true');
      });
    } finally {
      unmount(handle);
    }
  });

  it('lays out a circular avatar bar and a tall media bar', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const bars = shimmerBars(handle.container) as HTMLElement[];
      // Avatar: 40x40 fully rounded.
      const avatar = bars[0];
      expect(avatar.style.width).toBe('40px');
      expect(avatar.style.height).toBe('40px');
      expect(avatar.style.borderRadius).toBe('20px');
      // Media block: full width, 200px tall.
      const media = bars.find(b => b.style.height === '200px');
      expect(media).toBeDefined();
      expect(media!.style.width).toBe('100%');
    } finally {
      unmount(handle);
    }
  });
});

// ─── 5. Animation lifecycle ─────────────────────────────────────────────

describe('Loading states — shimmer animation lifecycle', () => {
  it('starts a looped animation for every bar on mount', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      expect(Animated.loop).toHaveBeenCalledTimes(EXPECTED_BAR_COUNT);
      expect(animationHandles.start).toHaveBeenCalledTimes(EXPECTED_BAR_COUNT);
      expect(animationHandles.stop).not.toHaveBeenCalled();
    } finally {
      unmount(handle);
    }
  });

  it('loops a two-step opacity sequence between 0.3 and 0.7', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      // Each bar sequences two timings; assert the pair of targets rather
      // than the raw call count so the intent survives a re-order.
      const targets = (Animated.timing as unknown as jest.Mock).mock.calls.map(
        ([, config]) => (config as { toValue: number }).toValue,
      );
      expect(new Set(targets)).toEqual(new Set([0.3, 0.7]));
      const durations = (Animated.timing as unknown as jest.Mock).mock.calls.map(
        ([, config]) => (config as { duration: number }).duration,
      );
      expect(new Set(durations)).toEqual(new Set([800]));
    } finally {
      unmount(handle);
    }
  });

  it('drives the animation off the JS thread', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const calls = (Animated.timing as unknown as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      calls.forEach(([, config]) => {
        expect((config as { useNativeDriver: boolean }).useNativeDriver).toBe(true);
      });
    } finally {
      unmount(handle);
    }
  });

  it('stops every animation on unmount (no leaked loops)', () => {
    const handle = mount(React.createElement(PostSkeleton));
    unmount(handle);
    expect(animationHandles.stop).toHaveBeenCalledTimes(EXPECTED_BAR_COUNT);
  });
});

// ─── 6. Skeleton → content handoff ──────────────────────────────────────

describe('Loading states — transition from skeleton to real content', () => {
  it('unmounts the skeleton and renders the content once data arrives', () => {
    // Real screens follow this shape: `isLoading ? <Skeleton/> : <Content/>`.
    const Content: React.FC<{ message: string }> = ({ message }) =>
      React.createElement('div', { 'data-testid': 'real-content' }, message);

    const Screen: React.FC<{ loaded: boolean }> = ({ loaded }) =>
      loaded
        ? React.createElement(Content, { message: 'hello world' })
        : React.createElement(PostSkeleton);

    // 1. Loading phase: shimmer bars on screen, no content.
    const handle = mount(React.createElement(Screen, { loaded: false }));
    try {
      expect(shimmerBars(handle.container).length).toBe(EXPECTED_BAR_COUNT);
      expect(
        handle.container.querySelector('[data-testid="real-content"]'),
      ).toBeNull();
    } finally {
      unmount(handle);
    }

    // 2. Loaded phase: content only, and no shimmer left behind.
    const handle2 = mount(React.createElement(Screen, { loaded: true }));
    try {
      const content = handle2.container.querySelector('[data-testid="real-content"]');
      expect(content).not.toBeNull();
      expect(content?.textContent).toBe('hello world');
      expect(shimmerBars(handle2.container)).toHaveLength(0);
    } finally {
      unmount(handle2);
    }
  });
});
