/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/ui/Skeleton.test.tsx
 * The pulsing placeholder block — components/native/ui/Skeleton.
 *
 * Mounted rather than invoked: the pulse is an effect and reduce-motion is
 * read asynchronously, so both need a real render to observe.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 1. Mock react-native ────────────────────────────────────────────────

jest.mock('react-native', () => require('../../support/reactNativeDom'));

// ─── 2. Imports ─────────────────────────────────────────────────────────

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import Skeleton, {
  PULSE_MIN_OPACITY,
  PULSE_MAX_OPACITY,
  PULSE_DURATION_MS,
} from '../../../components/native/ui/Skeleton';
import type { SkeletonProps } from '../../../components/native/ui/Skeleton';
import { color } from '../../../theme/tokens';

const handles = (Animated as unknown as { __handles: { start: jest.Mock; stop: jest.Mock } })
  .__handles;
const isReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as unknown as jest.Mock;

// ─── 3. Helpers ─────────────────────────────────────────────────────────

interface MountHandle {
  root: Root;
  container: HTMLDivElement;
}

async function mount(props: SkeletonProps = {}): Promise<MountHandle> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  // Async act: the reduce-motion read resolves on a microtask after mount.
  await act(async () => {
    root.render(<Skeleton {...props} />);
  });
  return { root, container };
}

function unmount(handle: MountHandle): void {
  act(() => {
    handle.root.unmount();
  });
  handle.container.remove();
}

const blockOf = (handle: MountHandle) =>
  handle.container.querySelector('div[data-animated="true"]') as HTMLElement;

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

beforeEach(() => {
  jest.clearAllMocks();
  isReduceMotionEnabled.mockImplementation(() => Promise.resolve(false));
});

// ─── 4. Shape ───────────────────────────────────────────────────────────

describe('Skeleton — shape', () => {
  it('is a square-cornered bgPanel block', async () => {
    const handle = await mount({ width: 120, height: 14 });
    try {
      const block = blockOf(handle);
      expect(block.style.backgroundColor).toBe(rgb(color.bgPanel));
      expect(block.style.width).toBe('120px');
      expect(block.style.height).toBe('14px');
      expect(parseFloat(block.style.borderRadius)).toBe(0);
    } finally {
      unmount(handle);
    }
  });

  it('defaults to the full width', async () => {
    const handle = await mount({ height: 14 });
    try {
      expect(blockOf(handle).style.width).toBe('100%');
    } finally {
      unmount(handle);
    }
  });

  it('draws a circle of diameter height', async () => {
    const handle = await mount({ height: 36, circle: true });
    try {
      const block = blockOf(handle);
      expect(block.style.width).toBe('36px');
      expect(block.style.height).toBe('36px');
      expect(block.style.borderRadius).toBe('18px');
    } finally {
      unmount(handle);
    }
  });

  it('carries an animated opacity driver', async () => {
    const handle = await mount({ height: 14 });
    try {
      expect(blockOf(handle).getAttribute('data-has-opacity-driver')).toBe('true');
    } finally {
      unmount(handle);
    }
  });
});

// ─── 5. Pulse ───────────────────────────────────────────────────────────

describe('Skeleton — pulse', () => {
  it('loops a native-driven opacity pulse, and stops it on unmount', async () => {
    const handle = await mount({ height: 14 });
    expect(Animated.loop).toHaveBeenCalledTimes(1);
    expect(handles.start).toHaveBeenCalledTimes(1);

    const configs = (Animated.timing as unknown as jest.Mock).mock.calls.map(
      ([, config]) => config as { toValue: number; duration: number; useNativeDriver: boolean },
    );
    expect(new Set(configs.map((c) => c.toValue))).toEqual(
      new Set([PULSE_MIN_OPACITY, PULSE_MAX_OPACITY]),
    );
    configs.forEach((c) => {
      expect(c.duration).toBe(PULSE_DURATION_MS);
      expect(c.useNativeDriver).toBe(true);
    });

    unmount(handle);
    expect(handles.stop).toHaveBeenCalledTimes(1);
  });

  it('holds still when reduce motion is on', async () => {
    isReduceMotionEnabled.mockImplementation(() => Promise.resolve(true));
    const handle = await mount({ height: 14 });
    try {
      // The first effect run may start the loop before the setting resolves;
      // once it does, the loop is stopped and nothing restarts it.
      const starts = handles.start.mock.calls.length;
      expect(handles.stop).toHaveBeenCalledTimes(starts);
      expect(blockOf(handle)).not.toBeNull();
    } finally {
      unmount(handle);
    }
  });

  it('listens for the reduce-motion setting changing, and unsubscribes', async () => {
    const handle = await mount({ height: 14 });
    const addListener = AccessibilityInfo.addEventListener as unknown as jest.Mock;
    expect(addListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    const subscription = addListener.mock.results[0].value as { remove: jest.Mock };
    unmount(handle);
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
