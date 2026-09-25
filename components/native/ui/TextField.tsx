import React, { forwardRef, useState } from 'react';
import { TextInput, View, Text, StyleSheet } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { color, radius, space, type, withAlpha } from '../../../theme/tokens';
import MonoLabel from './MonoLabel';

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

export type TextFieldVariant = 'panel' | 'overlay';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /**
   * `panel` (the default) sits on the white ground. `overlay` is translucent
   * with inverse text, for fields laid over full-bleed dark media such as the
   * OneSnap viewer's reply box.
   */
  variant?: TextFieldVariant;
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

/** Surface, border, text and placeholder colours for each variant. */
export const TEXT_FIELD_COLORS: Record<
  TextFieldVariant,
  { fill: string; border: string; focusedBorder: string; text: string; placeholder: string }
> = {
  panel: {
    fill: color.bgPanel,
    border: color.border,
    focusedBorder: color.text,
    text: color.text,
    placeholder: color.textMuted,
  },
  overlay: {
    fill: withAlpha(color.inverse, 0.14),
    border: withAlpha(color.inverse, 0.24),
    focusedBorder: color.inverse,
    text: color.inverse,
    placeholder: withAlpha(color.inverse, 0.6),
  },
};

/**
 * A text input on the panel surface: `bgPanel` fill behind a 1px `border`
 * hairline that darkens to ink while the field has focus. The `overlay`
 * variant does the same in translucent white over dark media.
 *
 * Forwards its ref to the underlying TextInput so a screen can still call
 * `focus()` or `blur()` on it.
 */
const TextField = forwardRef<TextInput, TextFieldProps>(
  (
    { variant = 'panel', label, error, containerStyle, inputStyle, multiline, onFocus, onBlur, ...rest },
    ref,
  ) => {
    const [focused, setFocused] = useState(false);
    const colors = TEXT_FIELD_COLORS[variant];

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
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.focusedBorder}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            multiline && styles.multiline,
            {
              backgroundColor: colors.fill,
              color: colors.text,
              borderColor: focused ? colors.focusedBorder : colors.border,
            },
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
    borderWidth: 1,
    borderRadius: radius.none,
    fontFamily: type.body,
    fontSize: 15,
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
