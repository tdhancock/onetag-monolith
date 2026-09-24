
//
// Local ambient declarations for test-only modules without bundled types.
// `@types/react-dom` is not installed; we declare the minimum surface the
// jsdom suites need from `react-dom/client` (`createRoot`) — useAppContext,
// LoadingStates, PostCard.aspect and realtimeBridge all mount through it.
// `act` comes from `react` itself (React 19), not `react-dom/test-utils`.

declare module 'react-dom/client' {
  import type { ReactNode, ReactElement } from 'react';

  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
