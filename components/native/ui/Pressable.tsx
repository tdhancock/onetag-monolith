import React, { forwardRef, useState } from 'react';
import { Pressable as NativePressable } from 'react-native';
import type { GestureResponderEvent, PressableProps as NativePressableProps, View } from 'react-native';

export type PressableProps = NativePressableProps;

/**
 * React Native's Pressable, with `style` and `children` as functions of press
 * state working again.
 *
 * NativeWind's JSX runtime wraps every Pressable to translate `className`, and
 * in doing so replaces a `style` function with an empty object: the control
 * loses its size, its layout and its feedback, and nothing warns. Tests never
 * see it because they render without NativeWind. This component tracks the
 * press itself and hands the native Pressable a resolved style, which the
 * wrapper passes through intact.
 *
 * Use it wherever the style depends on `pressed`. A react-native Pressable
 * with a style function is rejected by `__tests__/components/ui/Pressable.test.tsx`.
 */
const Pressable = forwardRef<View, PressableProps>(
  ({ style, children, onPressIn, onPressOut, testOnly_pressed, ...rest }, ref) => {
    const [pressedState, setPressed] = useState(false);
    const pressed = testOnly_pressed ?? pressedState;

    const handlePressIn = (event: GestureResponderEvent) => {
      setPressed(true);
      onPressIn?.(event);
    };

    const handlePressOut = (event: GestureResponderEvent) => {
      setPressed(false);
      onPressOut?.(event);
    };

    return (
      <NativePressable
        ref={ref}
        {...rest}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={typeof style === 'function' ? style({ pressed }) : style}
      >
        {typeof children === 'function' ? children({ pressed }) : children}
      </NativePressable>
    );
  },
);

Pressable.displayName = 'Pressable';

export default Pressable;
