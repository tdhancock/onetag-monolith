import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, View } from 'react-native';
import type { KeyboardEvent, StyleProp, ViewStyle } from 'react-native';

/** How far a view's bottom edge reaches below the keyboard's top, in points. Never negative. */
export const keyboardOverlap = (viewBottom: number, keyboardTop: number): number =>
  Math.max(0, Math.round(viewBottom - keyboardTop));

interface KeyboardAvoiderProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pads its bottom by exactly as much of it as the keyboard covers, so a
 * composer or toolbar at its foot sits on top of the keyboard.
 *
 * Used instead of React Native's KeyboardAvoidingView, which compares its
 * frame *relative to its parent* with the keyboard's position *on screen*. The
 * two only agree when the view starts at the top of the screen; anywhere else
 * it needs a `keyboardVerticalOffset` equal to the gap, which differs between
 * a page-sheet modal, a screen under a stack header, and devices. Compose,
 * Edit profile and Comments each got that number wrong, and their bottom rows
 * ended up under the keyboard. This view measures itself in window
 * coordinates when the keyboard moves, so it needs no offset at all.
 */
const KeyboardAvoider: React.FC<KeyboardAvoiderProps> = ({ children, style }) => {
  const ref = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // Move in step with the keyboard on iOS, which reports its animation.
    const follow = (event: KeyboardEvent) => {
      if (Platform.OS === 'ios' && event.duration) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
    };

    const onChange = (event: KeyboardEvent) => {
      const keyboardTop = event.endCoordinates.screenY;
      // The view's own frame does not include the padding it adds, so this
      // measures the same edge however many times the keyboard moves.
      ref.current?.measureInWindow?.((_x, y, _width, height) => {
        follow(event);
        setInset(keyboardOverlap(y + height, keyboardTop));
      });
    };

    const onHide = (event: KeyboardEvent) => {
      follow(event);
      setInset(0);
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            // Covers showing, and the keyboard changing height while up.
            Keyboard.addListener('keyboardWillChangeFrame', onChange),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [Keyboard.addListener('keyboardDidShow', onChange), Keyboard.addListener('keyboardDidHide', onHide)];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return (
    <View ref={ref} style={[style, { paddingBottom: inset }]}>
      {children}
    </View>
  );
};

export default KeyboardAvoider;
