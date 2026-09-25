/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/LoadingStates.test.tsx
 *
 * Loading-state UI, covering components/native/PostSkeleton.
 *
 * Since ONE-64 the skeleton is built from the `Skeleton` primitive in the
 * shape of the re-skinned post: an avatar row, a full-bleed 4:5 media block
 * and two text lines, each block a `bgPanel` fill with a looped opacity
 * pulse. The primitive's own contract (reduce motion included) is covered in
 * __tests__/components/ui/Skeleton.test.tsx; this suite covers the post's
 * shape and the lifecycle of its pulses.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 1. Mock react-native ────────────────────────────────────────────────
// PostSkeleton needs View, StyleSheet, AccessibilityInfo and the Animated API
// (Value / loop / sequence / timing / View). The shared DOM-passthrough shim
// renders to DOM nodes so react-dom can mount the real component, and
// exposes the loop handle so the test can assert that the animation is
// started on mount and stopped on unmount.

jest.mock('react-native', () => require('../support/reactNativeDom'), { virtual: true });
// Skeleton comes through the components/native/ui barrel, which also carries
// Avatar and so expo-image.
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
// The barrel reaches the icons (ListRow, Sheet), and through them react-native-svg.
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

// ─── 2. Imports ─────────────────────────────────────────────────────────
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Animated } from 'react-native';
import PostSkeleton, {
  SKELETON_AVATAR_SIZE,
  SKELETON_MEDIA_ASPECT_RATIO,
} from '../../components/native/PostSkeleton';
import {
  PULSE_MIN_OPACITY,
  PULSE_MAX_OPACITY,
  PULSE_DURATION_MS,
} from '../../components/native/ui/Skeleton';
import { color } from '../../theme/tokens';

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

/** jsdom normalises hex colours to rgb(); compare in that form. */
const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

function unmount(handle: MountHandle): void {
  act(() => {
    handle.root.unmount();
  });
  handle.container.remove();
}

const shimmerBars = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div[data-animated="true"]'));

// The blocks PostSkeleton lays out, in document order: avatar, the two
// header lines, the media block, then the likes and caption lines.
const EXPECTED_BAR_COUNT = 6;

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

  it('paints every block on the bgPanel surface', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const bars = shimmerBars(handle.container);
      expect(bars.length).toBeGreaterThan(0);
      bars.forEach(bar => {
        expect((bar as HTMLElement).style.backgroundColor).toBe(rgb(color.bgPanel));
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

  it('leads with a circular 36pt avatar, like the post header', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const avatar = (shimmerBars(handle.container) as HTMLElement[])[0];
      expect(avatar.style.width).toBe(`${SKELETON_AVATAR_SIZE}px`);
      expect(avatar.style.height).toBe(`${SKELETON_AVATAR_SIZE}px`);
      expect(avatar.style.borderRadius).toBe(`${SKELETON_AVATAR_SIZE / 2}px`);
    } finally {
      unmount(handle);
    }
  });

  it('holds a full-bleed, square-cornered media block', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      // The only block with no fixed height: it takes its height from the
      // aspect ratio instead.
      const media = (shimmerBars(handle.container) as HTMLElement[]).filter(
        b => b.style.height === '',
      );
      expect(media).toHaveLength(1);
      expect(media[0].style.width).toBe('100%');
      expect(parseFloat(media[0].style.borderRadius)).toBe(0);
    } finally {
      unmount(handle);
    }
  });

  it('sizes the media block 4:5, the post card default', () => {
    // jsdom drops aspect-ratio from inline styles, so this reads the element
    // tree PostSkeleton builds (it has no hooks of its own) rather than the DOM.
    type Node = React.ReactElement<{ style?: unknown; children?: React.ReactNode }>;
    const tree = (PostSkeleton as unknown as () => Node)();
    const blocks = React.Children.toArray(tree.props.children) as Node[];
    const media = blocks.find(b => (b.props.style as { aspectRatio?: number })?.aspectRatio);
    expect(media).toBeDefined();
    expect((media!.props.style as { aspectRatio: number }).aspectRatio).toBe(
      SKELETON_MEDIA_ASPECT_RATIO,
    );
    expect(SKELETON_MEDIA_ASPECT_RATIO).toBe(0.8);
  });

  it('ends with two text lines under the media', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      const bars = shimmerBars(handle.container) as HTMLElement[];
      const mediaIndex = bars.findIndex(b => b.style.height === '');
      expect(bars.slice(mediaIndex + 1)).toHaveLength(2);
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

  it('loops a two-step opacity sequence between the pulse bounds', () => {
    const handle = mount(React.createElement(PostSkeleton));
    try {
      // Each bar sequences two timings; assert the pair of targets rather
      // than the raw call count so the intent survives a re-order.
      const targets = (Animated.timing as unknown as jest.Mock).mock.calls.map(
        ([, config]) => (config as { toValue: number }).toValue,
      );
      expect(new Set(targets)).toEqual(new Set([PULSE_MIN_OPACITY, PULSE_MAX_OPACITY]));
      const durations = (Animated.timing as unknown as jest.Mock).mock.calls.map(
        ([, config]) => (config as { duration: number }).duration,
      );
      expect(new Set(durations)).toEqual(new Set([PULSE_DURATION_MS]));
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
