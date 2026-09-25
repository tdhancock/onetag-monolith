import React, { forwardRef, useState } from 'react';
import { View, Text, ScrollView, Dimensions, StyleSheet } from 'react-native';
import type { TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardAvoider from './KeyboardAvoider';
import { IconButton, Pressable, TextField, letterSpacingFor } from './ui';
import type { TextFieldProps } from './ui';
import { EyeIcon, EyeSlashIcon } from './Icons';
import { HOME_HEADER_BRAND } from '../../lib/screens/home';
import { color, space, type } from '../../theme/tokens';

export interface AuthScaffoldProps {
  /** One line under the wordmark: "Sign in to continue". */
  subtitle: string;
  children: React.ReactNode;
  /** The switch link pinned to the bottom, e.g. "New here? Create an account". */
  footer?: React.ReactNode;
}

/** The wordmark's size here — the Home header's treatment, larger. */
const WORDMARK_SIZE = 32;
/** Space above the wordmark, so it lands in the screen's top third. */
const HEADER_TOP = Math.round(Dimensions.get('window').height * 0.1);

/**
 * The shared frame of the sign-in screens: white, the OneTag wordmark and a
 * subtitle centred near the top, the form beneath, and a switch link at the
 * foot. It scrolls, and pads itself clear of the keyboard, so the focused
 * field and the button stay reachable with the keyboard up.
 */
const AuthScaffold: React.FC<AuthScaffoldProps> = ({ subtitle, children, footer }) => (
  <SafeAreaView style={styles.screen}>
    <KeyboardAvoider style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.header}>
          <Text style={styles.wordmark} accessibilityRole="header">
            {HOME_HEADER_BRAND}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.form}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoider>
  </SafeAreaView>
);

export interface AuthSwitchProps {
  /** The plain half: "New here?". */
  prompt: string;
  /** The bold half, the link itself: "Create an account". */
  action: string;
  onPress: () => void;
}

/** "New here? **Create an account**" — the whole line is the target. */
export const AuthSwitch: React.FC<AuthSwitchProps> = ({ prompt, action, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="link"
    accessibilityLabel={action}
    hitSlop={8}
    style={({ pressed }) => [styles.switch, pressed && styles.pressed]}
  >
    <Text style={styles.switchPrompt}>
      {prompt} <Text style={styles.switchAction}>{action}</Text>
    </Text>
  </Pressable>
);

/** A quiet text link, such as "Forgot password?". */
export const AuthLink: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="link"
    accessibilityLabel={label}
    hitSlop={8}
    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
  >
    <Text style={styles.linkLabel}>{label}</Text>
  </Pressable>
);

/**
 * A form-level error — wrong credentials, a server refusal — shown once,
 * above the button, rather than in an Alert.
 */
export const AuthFormError: React.FC<{ message: string }> = ({ message }) => (
  <View style={styles.formError} accessibilityLiveRegion="polite" accessibilityRole="alert">
    <Text style={styles.formErrorText}>{message}</Text>
  </View>
);

/**
 * A TextField for a password, with a show/hide control inside its trailing
 * edge. Everything else — autofill hints, return key — is the caller's.
 */
export const PasswordField = forwardRef<TextInput, Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <TextField
        ref={ref}
        {...props}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        trailing={
          <IconButton
            icon={
              visible ? (
                <EyeSlashIcon color={color.textMid} size={20} strokeWidth={1.6} />
              ) : (
                <EyeIcon color={color.textMid} size={20} strokeWidth={1.6} />
              )
            }
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible(v => !v)}
          />
        }
      />
    );
  },
);

PasswordField.displayName = 'PasswordField';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
  },
  header: {
    alignItems: 'center',
    paddingTop: HEADER_TOP,
    paddingBottom: space.xxl,
  },
  wordmark: {
    fontFamily: type.mono,
    fontSize: WORDMARK_SIZE,
    letterSpacing: letterSpacingFor(WORDMARK_SIZE),
    color: color.text,
  },
  subtitle: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
  },
  form: {
    gap: space.md,
  },
  // Pushed to the foot of the scroll area, above the safe area.
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: space.xl,
    paddingBottom: space.lg,
  },
  switch: {
    minHeight: 44,
    justifyContent: 'center',
  },
  switchPrompt: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMid,
  },
  switchAction: {
    fontFamily: type.bodyBold,
    color: color.text,
  },
  link: {
    minHeight: 44,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.textMid,
  },
  pressed: {
    opacity: 0.6,
  },
  formError: {
    padding: space.md,
    backgroundColor: color.bgPanel,
  },
  formErrorText: {
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.heart,
  },
});

export default AuthScaffold;
