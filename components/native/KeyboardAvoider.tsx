import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import type { KeyboardEvent, StyleProp, ViewStyle } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../../lib/useKeyboardHeight';

/** How far a view's bottom edge reaches below the keyboard's top, in points. Never negative. */
export const keyboardOverlap = (viewBottom: number, keyboardTop: number): number =>
  Math.max(0, Math.round(viewBottom - keyboardTop));

/**
 * How much of a view at the foot of the screen a keyboard this tall covers:
 * its height, less whatever lies between the view and the bottom edge, which
 * the keyboard covers first. Never negative.
 */
export const keyboardCover = (keyboardHeight: number, offsetBelow: number): number =>
  Math.max(0, Math.round(keyboardHeight - offsetBelow));

/** The home indicator's inset: what a screen's bottom-edge SafeAreaView pads by. */
const homeIndicatorInset = (): number => initialWindowMetrics?.insets.bottom ?? 0;

interface KeyboardAvoiderProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * What lies between this view's bottom edge and the bottom of the screen.
   * Defaults to the home indicator's inset, because every screen puts this
   * view last inside a SafeAreaView that pads the bottom edge.
   */
  offsetBelow?: number;
}

/** Android's padding: the view measures how much of it the keyboard covers. */
const useMeasuredOverlap = (ref: React.RefObject<View | null>): number => {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'ios') return undefined;

    const onShow = (event: KeyboardEvent) => {
      const keyboardTop = event.endCoordinates.screenY;
      // The view's own frame does not include the padding it adds, so this
      // measures the same edge however many times the keyboard moves.
      ref.current?.measureInWindow?.((_x, y, _width, height) => {
        setOverlap(keyboardOverlap(y + height, keyboardTop));
      });
    };

    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidHide', () => setOverlap(0)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [ref]);

  return overlap;
};

/**
 * Pads its bottom by exactly as much of it as the keyboard covers, so a
 * composer or toolbar at its foot sits on top of the keyboard. It must sit at
 * the foot of its screen.
 *
 * On iOS the padding comes from the keyboard's height alone. Measuring the
 * view doesn't work there: inside a page-sheet modal the layout doesn't know
 * how far down the screen the sheet starts, so `measureInWindow` reports the
 * view that much too high, and Compose, Messages and Edit profile lost their
 * bottom rows under the keyboard by the sheet's offset. React Native's
 * KeyboardAvoidingView measures against its parent, and is wrong in the same
 * way and more.
 *
 * On Android a screen is laid out where it is drawn, so the view measures
 * itself in the window when the keyboard shows.
 */
const KeyboardAvoider: React.FC<KeyboardAvoiderProps> = ({ children, style, offsetBelow }) => {
  const ref = useRef<View>(null);
  const keyboardHeight = useKeyboardHeight();
  const measured = useMeasuredOverlap(ref);
  const inset =
    Platform.OS === 'ios' ? keyboardCover(keyboardHeight, offsetBelow ?? homeIndicatorInset()) : measured;

  return (
    <View ref={ref} style={[style, { paddingBottom: inset }]}>
      {children}
    </View>
  );
};

export default KeyboardAvoider;
