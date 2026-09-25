import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the system "reduce motion" setting is on, kept current if the user
 * changes it while the app is open.
 *
 * Starts false and only updates on a change, so a device with the setting off
 * never re-renders because of this hook.
 */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive && enabled) setReduced(true);
      })
      .catch(() => {
        // An unreadable setting is treated as "motion allowed", the default.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
};

export default useReducedMotion;
