import React, { forwardRef, useState } from 'react';
import { TextInput, View, Text, StyleSheet } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { color, radius, space, type } from '../../../theme/tokens';
import MonoLabel from './MonoLabel';

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** A MonoLabel shown above the field. */
  label?: string;
  /** Error text shown beneath the field in `heart`. */
  error?: string | null;
  /** Wraps the label, field and error. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Applied to the input itself, after the defaults. */
  inputStyle?: StyleProp<TextStyle>;
}

/** The field's minimum height, in points — comfortably above the 44pt target. */
export const TEXT_FIELD_MIN_HEIGHT = 48;

/**
 * A text input on the panel surface: `bgPanel` fill behind a 1px `border`
 * hairline that darkens to ink while the field has focus.
 *
 * Forwards its ref to the underlying TextInput so a screen can still call
 * `focus()` or `blur()` on it.
 */
const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ label, error, containerStyle, inputStyle, multiline, onFocus, onBlur, ...rest }, ref) => {
    const [focused, setFocused] = useState(false);

    const handleFocus = (e: FocusEvent) => {
      setFocused(true);
      onFocus?.(e);
    };

    const handleBlur = (e: BlurEvent) => {
      setFocused(false);
      onBlur?.(e);
    };

    return (
      <View style={containerStyle}>
        {label ? (
          <MonoLabel color="textMid" style={styles.label}>
            {label}
          </MonoLabel>
        ) : null}
        <TextInput
          ref={ref}
          multiline={multiline}
          placeholderTextColor={color.textMuted}
          selectionColor={color.text}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            multiline && styles.multiline,
            { borderColor: focused ? color.text : color.border },
            inputStyle,
          ]}
          {...rest}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  },
);

TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  label: {
    marginBottom: space.sm,
  },
  input: {
    minHeight: TEXT_FIELD_MIN_HEIGHT,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: color.bgPanel,
    borderWidth: 1,
    borderRadius: radius.none,
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  multiline: {
    textAlignVertical: 'top',
  },
  error: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    color: color.heart,
  },
});

export default TextField;
