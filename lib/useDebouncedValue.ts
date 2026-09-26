// A value that follows another once it stops changing — for a search field,
// so a query runs when typing pauses rather than on every keystroke.

import { useEffect, useState } from 'react';

/** How long typing must pause before a search runs. The Explore search waits the same. */
export const SEARCH_DEBOUNCE_MS = 300;

export const useDebouncedValue = <T,>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
};
