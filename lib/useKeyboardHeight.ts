// How tall the iOS keyboard stands on screen, following it as it moves.
//
// iOS reports the keyboard's frame, and its animation, before it moves, so a
// view padded by this height moves in step with it. The height comes from the
// keyboard alone: nothing is measured, because inside a page-sheet modal the
// layout doesn't know how far down the screen the sheet starts, and anything
// measured there reads too high by that much.
//
// Always 0 on Android, where a screen measures itself instead (see
// components/native/KeyboardAvoider).

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform } from 'react-native';
import type { KeyboardEvent } from 'react-native';

/** The keyboard's height on screen, from where its top edge will be. Never negative. */
export const keyboardHeightOnScreen = (screenHeight: number, keyboardTop: number): number =>
  Math.max(0, Math.round(screenHeight - keyboardTop));

/** `enabled` off stops listening and reads 0: a closed sheet needn't follow the keyboard. */
export const useKeyboardHeight = (enabled: boolean = true): number => {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !enabled) {
      setHeight(0);
      return undefined;
    }

    // Already up, as when a sheet opens over a screen that is typing.
    const metrics = Keyboard.metrics?.();
    setHeight(metrics ? keyboardHeightOnScreen(Dimensions.get('window').height, metrics.screenY) : 0);

    const follow = (event: KeyboardEvent, next: number) => {
      if (event.duration) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      setHeight(next);
    };

    const subscriptions = [
      // Covers showing, and the keyboard changing height while up.
      Keyboard.addListener('keyboardWillChangeFrame', (event) =>
        follow(event, keyboardHeightOnScreen(Dimensions.get('window').height, event.endCoordinates.screenY)),
      ),
      Keyboard.addListener('keyboardWillHide', (event) => follow(event, 0)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [enabled]);

  return height;
};
