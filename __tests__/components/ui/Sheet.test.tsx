/**
 * @jest-environment jsdom
 *
 * target: __tests__/components/ui/Sheet.test.tsx
 * The bottom sheet of actions — components/native/ui/Sheet.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => require('../../support/reactNativeDom'));
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import Sheet, { SheetRow, SHEET_ROW_HEIGHT } from '../../../components/native/ui/Sheet';
import { color } from '../../../theme/tokens';

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

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

describe('Sheet', () => {
  it('renders nothing while hidden', () => {
    const el = mount(<Sheet visible={false} onClose={jest.fn()}><SheetRow label="Block" onPress={jest.fn()} /></Sheet>);
    expect(el.textContent).toBe('');
  });

  it('shows its rows and an outline Cancel that closes it', () => {
    const onClose = jest.fn();
    const el = mount(<Sheet visible onClose={onClose}><SheetRow label="Block" onPress={jest.fn()} /></Sheet>);
    expect(button(el, 'Block')).not.toBeNull();
    const cancel = Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!;
    act(() => cancel.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the scrim is tapped', () => {
    const onClose = jest.fn();
    const el = mount(<Sheet visible onClose={onClose}><SheetRow label="Block" onPress={jest.fn()} /></Sheet>);
    act(() => button(el, 'Close')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('heads a second step with a title and a back arrow', () => {
    const onBack = jest.fn();
    const el = mount(
      <Sheet visible onClose={jest.fn()} title="Why are you reporting this?" onBack={onBack}>
        <SheetRow label="It's spam" onPress={jest.fn()} />
      </Sheet>,
    );
    expect(el.textContent).toContain('Why are you reporting this?');
    act(() => button(el, 'Back')!.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SheetRow', () => {
  it('is at least 56pt tall and fires on press', () => {
    const onPress = jest.fn();
    const el = mount(<SheetRow label="Report" onPress={onPress} />);
    const row = button(el, 'Report')!;
    expect(parseFloat(row.style.minHeight)).toBe(SHEET_ROW_HEIGHT);
    act(() => row.click());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('colours a destructive row heart red', () => {
    const el = mount(<SheetRow label="Block" destructive onPress={jest.fn()} />);
    const label = button(el, 'Block')!.querySelector('span') as HTMLElement;
    expect(label.style.color).toBe(rgb(color.heart));
  });
});
