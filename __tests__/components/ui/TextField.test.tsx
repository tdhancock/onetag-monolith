/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/ui/TextField.test.tsx
 * The panel text input — components/native/ui/TextField.
 *
 * Mounted rather than invoked: the focused border is component state, so the
 * suite needs a real render to drive focus and blur through it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 1. Mock react-native ────────────────────────────────────────────────

jest.mock('react-native', () => require('../../support/reactNativeDom'), { virtual: true });

// ─── 2. Imports ─────────────────────────────────────────────────────────

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import TextField, {
  TEXT_FIELD_COLORS,
  TEXT_FIELD_MIN_HEIGHT,
} from '../../../components/native/ui/TextField';
import type { TextFieldProps } from '../../../components/native/ui/TextField';
import { color } from '../../../theme/tokens';

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

/**
 * jsdom normalises some colour properties to rgb() and leaves others (the
 * border shorthands) as written, so both sides go through the same probe.
 */
const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const withField = (props: TextFieldProps, run: (handle: MountHandle) => void) => {
  const handle = mount(<TextField {...props} />);
  try {
    run(handle);
  } finally {
    unmount(handle);
  }
};

const inputOf = (handle: MountHandle) => handle.container.querySelector('input')!;

// ─── 4. Surface ─────────────────────────────────────────────────────────

describe('TextField — surface', () => {
  it('sits on bgPanel behind a 1px border hairline', () => {
    withField({ placeholder: 'Say something' }, (handle) => {
      const input = inputOf(handle);
      expect(input.style.backgroundColor).toBe(rgb(color.bgPanel));
      expect(input.style.borderWidth).toBe('1px');
      expect(rgb(input.style.borderColor)).toBe(rgb(color.border));
    });
  });

  it('is at least 48pt tall', () => {
    expect(TEXT_FIELD_MIN_HEIGHT).toBeGreaterThanOrEqual(48);
    withField({}, (handle) => {
      expect(inputOf(handle).style.minHeight).toBe(`${TEXT_FIELD_MIN_HEIGHT}px`);
    });
  });

  it('shows its placeholder in textMuted', () => {
    withField({ placeholder: 'Say something' }, (handle) => {
      const input = inputOf(handle);
      expect(input.getAttribute('placeholder')).toBe('Say something');
      expect(input.getAttribute('data-placeholder-color')).toBe(color.textMuted);
    });
  });

  it('passes multiline through', () => {
    withField({ multiline: true }, (handle) => {
      expect(inputOf(handle).getAttribute('data-multiline')).toBe('true');
    });
  });
});

// ─── 5. Focus ───────────────────────────────────────────────────────────

describe('TextField — focus', () => {
  it('darkens the border to ink while focused, and back on blur', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    withField({ onFocus, onBlur }, (handle) => {
      const input = inputOf(handle);
      act(() => input.focus());
      expect(rgb(input.style.borderColor)).toBe(rgb(color.text));
      expect(onFocus).toHaveBeenCalledTimes(1);

      act(() => input.blur());
      expect(rgb(input.style.borderColor)).toBe(rgb(color.border));
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── 6. The overlay variant ─────────────────────────────────────────────

describe('TextField — overlay variant', () => {
  it('is translucent white with inverse text, for dark media', () => {
    withField({ variant: 'overlay', placeholder: 'Reply' }, (handle) => {
      const input = inputOf(handle);
      const overlay = TEXT_FIELD_COLORS.overlay;
      expect(overlay.fill).toMatch(/^rgba\(255, 255, 255, 0\.\d+\)$/);
      expect(input.style.backgroundColor).toBe(overlay.fill);
      expect(rgb(input.style.color)).toBe(rgb(color.inverse));
      expect(input.getAttribute('data-placeholder-color')).toBe(overlay.placeholder);
    });
  });

  it('brightens its border to inverse while focused', () => {
    withField({ variant: 'overlay' }, (handle) => {
      const input = inputOf(handle);
      act(() => input.focus());
      expect(rgb(input.style.borderColor)).toBe(rgb(color.inverse));
    });
  });

  it('defaults to the panel variant', () => {
    expect(TEXT_FIELD_COLORS.panel.fill).toBe(color.bgPanel);
    withField({}, (handle) => {
      expect(inputOf(handle).style.backgroundColor).toBe(rgb(color.bgPanel));
    });
  });
});

// ─── 7. Label, error and ref ────────────────────────────────────────────

describe('TextField — label, error and ref', () => {
  it('renders a label above the field', () => {
    withField({ label: 'Caption' }, (handle) => {
      const spans = Array.from(handle.container.querySelectorAll('span'));
      expect(spans.map((s) => s.textContent)).toContain('Caption');
      // The label precedes the input in document order.
      const label = spans.find((s) => s.textContent === 'Caption')!;
      expect(
        label.compareDocumentPosition(inputOf(handle)) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('renders error text in heart, and nothing when there is no error', () => {
    withField({ error: 'Too long' }, (handle) => {
      const error = Array.from(handle.container.querySelectorAll('span')).find(
        (s) => s.textContent === 'Too long',
      ) as HTMLElement;
      expect(error).toBeDefined();
      expect(error.style.color).toBe(rgb(color.heart));
    });
    withField({ error: null }, (handle) => {
      expect(handle.container.querySelectorAll('span')).toHaveLength(0);
    });
  });

  it('forwards its ref to the underlying input', () => {
    const ref = React.createRef<unknown>();
    const handle = mount(<TextField ref={ref as never} />);
    try {
      expect(ref.current).toBe(inputOf(handle));
    } finally {
      unmount(handle);
    }
  });

  it('reports typed text through onChangeText', () => {
    const onChangeText = jest.fn();
    withField({ onChangeText }, (handle) => {
      const input = inputOf(handle);
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'hello');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(onChangeText).toHaveBeenCalledWith('hello');
    });
  });
});
