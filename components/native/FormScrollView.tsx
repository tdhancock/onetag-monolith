import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from 'react-native';
import { space } from '../../theme/tokens';

/** The room kept around a field brought into view, so its label and hint show too. */
export const REVEAL_MARGIN = space.xl;

/**
 * Where to scroll so a field is in view, or null when it already is. `field`
 * is its place in the scroll view's content; `viewport` is the stretch of
 * content showing. A field taller than the viewport shows its top, where the
 * caret starts.
 */
export const revealOffset = (
  field: { y: number; height: number },
  viewport: { offset: number; height: number },
  margin: number = REVEAL_MARGIN,
): number | null => {
  const top = Math.max(0, field.y - margin);
  const bottom = field.y + field.height + margin;
  if (top < viewport.offset) return top;
  if (bottom > viewport.offset + viewport.height) {
    return bottom - top > viewport.height ? top : bottom - viewport.height;
  }
  return null;
};

type Measurable = {
  measureLayout: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
};

/** What React Native's ScrollView has at runtime but leaves out of its types. */
type WithInnerView = { getInnerViewRef?: () => unknown };

/**
 * A form's ScrollView, which keeps the focused field in view when the
 * keyboard comes up.
 *
 * Put it inside a KeyboardAvoider, which shrinks it to the space above the
 * keyboard. Shrinking alone leaves a field in the lower half of the form
 * where it was, now below the visible part: signup's lower fields, Edit
 * profile's bio and the product and project forms all vanished under the
 * keyboard as they were tapped. This scrolls the field back into view. It
 * measures the field within its own content, so where the screen sits (a
 * modal, under a header) doesn't matter.
 */
const FormScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ onScroll, onLayout, scrollEventThrottle, keyboardShouldPersistTaps = 'handled', ...rest }, forwarded) => {
    const scroll = useRef<ScrollView>(null);
    useImperativeHandle(forwarded, () => scroll.current as ScrollView);

    const offset = useRef(0);
    const height = useRef(0);
    const keyboardUp = useRef(false);

    const reveal = useCallback(() => {
      const view = scroll.current;
      const content = (view as (ScrollView & WithInnerView) | null)?.getInnerViewRef?.();
      const field = TextInput.State?.currentlyFocusedInput?.() as Measurable | null | undefined;
      if (!view || !content || !field?.measureLayout || height.current <= 0) return;
      field.measureLayout(
        content,
        (_x, y, _width, fieldHeight) => {
          const target = revealOffset({ y, height: fieldHeight }, { offset: offset.current, height: height.current });
          if (target !== null) view.scrollTo({ y: target, animated: true });
        },
        // A focused field outside this form, such as a sheet's, isn't this one's to move.
        () => undefined,
      );
    }, []);

    useEffect(() => {
      // iOS says the keyboard is coming before the form shrinks, so the
      // shrink below can reveal at once; Android says so once it's up.
      const showing = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const subscriptions = [
        Keyboard.addListener(showing, () => {
          keyboardUp.current = true;
          reveal();
        }),
        // Also once the keyboard has settled, and when focus moves to
        // another field while it's up, which iOS reports as a new show.
        Keyboard.addListener('keyboardDidShow', () => {
          keyboardUp.current = true;
          reveal();
        }),
        Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
          keyboardUp.current = false;
        }),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    }, [reveal]);

    const handleLayout = (event: LayoutChangeEvent) => {
      height.current = event.nativeEvent.layout.height;
      // The KeyboardAvoider has just shrunk the form to fit above the keyboard.
      if (keyboardUp.current) reveal();
      onLayout?.(event);
    };

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    };

    return (
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onLayout={handleLayout}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        {...rest}
      />
    );
  },
);

FormScrollView.displayName = 'FormScrollView';

export default FormScrollView;
