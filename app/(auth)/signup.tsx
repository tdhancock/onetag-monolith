import React, { useState, useMemo, useRef } from 'react';
import { View, Text, ActivityIndicator, Keyboard, StyleSheet } from 'react-native';
import type { TextInput } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useStore } from '@tanstack/react-form';
import { supabase } from '../../services/supabase.native';
import { ensureCurrentUserProfile } from '../../services/profileBootstrap';
import { checkUsernameExists } from '../../features/profiles';
import { draftValidator } from '../../lib/formErrors';
import { EMPTY_SIGNUP_DRAFT, signupErrors } from '../../lib/screens/auth';
import { Button, EmptyState, MonoLabel, Pressable } from '../../components/native/ui';
import AuthScaffold, { AuthFormError, AuthSwitch } from '../../components/native/AuthScaffold';
import { useAppForm, useUsernameCheck } from '../../components/native/form';
import { EnvelopeIcon } from '../../components/native/Icons';
import { color, radius, space, type } from '../../theme/tokens';

const validateSignup = draftValidator(signupErrors);

export default function SignupScreen() {
  const router = useRouter();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // "Taken" shows inside the field before the form is sent; sending checks
  // again, so a handle claimed meanwhile never reaches the server.
  const usernameCheck = useUsernameCheck(checkUsernameExists);

  const form = useAppForm({
    defaultValues: EMPTY_SIGNUP_DRAFT,
    validators: { onMount: validateSignup, onChange: validateSignup },
    onSubmit: async ({ value }) => {
      setError('');
      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: value.email.trim(),
          password: value.password,
          options: {
            data: {
              full_name: value.fullName.trim(),
              username: value.username,
              birthday: value.birthday,
              bio: 'Hello, I am using OneTag',
            },
          },
        });

        if (signUpError) throw signUpError;

        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError('This email is already registered. Please try logging in.');
          return;
        }

        if (data.session) {
          const profileReady = await ensureCurrentUserProfile();
          if (!profileReady) {
            throw new Error('Account created but profile initialization failed. Please try logging in again.');
          }
          // Auto-confirmed: session exists, _layout auth listener handles redirect.
          setIsSuccess(true);
          return;
        }

        if (data.user && !data.session) {
          // Email confirmation required.
          setNeedsConfirmation(true);
        }
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred during sign up.');
      }
    },
  });

  const birthday = useStore(form.store, (state) => state.values.birthday);
  const email = useStore(form.store, (state) => state.values.email);
  const canSubmit = useStore(form.store, (state) => state.canSubmit);
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const submit = () => void form.handleSubmit();

  const formattedDate = useMemo(() => {
    if (!birthday) return '';
    try {
      const parts = birthday.split('-').map(p => parseInt(p, 10));
      const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
    } catch {
      return 'Invalid Date';
    }
  }, [birthday]);

  const openBirthday = () => {
    Keyboard.dismiss();
    setShowDatePicker(true);
  };

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      // iOS cancel / Android back — close the spinner
      setShowDatePicker(false);
      return;
    }
    if (selectedDate) {
      form.setFieldValue('birthday', selectedDate.toISOString().slice(0, 10)); // YYYY-MM-DD
    }
  };

  // ─── Email Confirmation Required Screen ────────
  if (needsConfirmation) {
    return (
      <SafeAreaView style={styles.outcome}>
        <EmptyState
          icon={<EnvelopeIcon color={color.text} size={48} strokeWidth={1.5} />}
          title="Check your email"
          body={`We sent a verification link to ${email.trim()}. Open it to activate your account, then come back and sign in.`}
          action={{ label: 'Back to sign in', onPress: () => router.replace('/(auth)/login') }}
        />
      </SafeAreaView>
    );
  }

  // ─── Success (auto-confirmed) Screen ───────────
  if (isSuccess) {
    return (
      <SafeAreaView style={styles.outcome}>
        <EmptyState title="Welcome!" body="Your account has been created successfully." />
        <ActivityIndicator color={color.textMuted} accessibilityLabel="Redirecting" />
      </SafeAreaView>
    );
  }

  // ─── Signup Form ───────────────────────────────
  return (
    <AuthScaffold
      subtitle="Create your account"
      footer={
        <AuthSwitch prompt="Have an account?" action="Sign in" onPress={() => router.replace('/(auth)/login')} />
      }
    >
      <form.AppField name="fullName">
        {(field) => (
          <field.TextField
            label="Full name"
            placeholder="Your name"
            textContentType="name"
            autoComplete="name"
            autoCapitalize="words"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => usernameRef.current?.focus()}
            accessibilityLabel="Full name"
          />
        )}
      </form.AppField>

      <form.AppField name="username" validators={usernameCheck.validators}>
        {(field) => (
          <field.UsernameField
            ref={usernameRef}
            check={usernameCheck}
            label="Username"
            placeholder="Pick a username"
            textContentType="username"
            autoComplete="username-new"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
            accessibilityLabel="Username"
          />
        )}
      </form.AppField>

      <form.AppField name="email">
        {(field) => (
          <field.TextField
            ref={emailRef}
            label="Email"
            placeholder="you@example.com"
            textContentType="emailAddress"
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Email"
          />
        )}
      </form.AppField>

      <form.AppField name="password">
        {(field) => (
          <field.PasswordField
            ref={passwordRef}
            label="Password"
            placeholder="At least 6 characters"
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
            accessibilityLabel="Password"
          />
        )}
      </form.AppField>

      {/* Checked against the password whenever either changes. */}
      <form.AppField name="confirmPassword">
        {(field) => (
          <field.PasswordField
            ref={confirmRef}
            label="Confirm password"
            placeholder="Type it again"
            textContentType="newPassword"
            autoComplete="new-password"
            // The birthday is a picker, not a keyboard field: the last text field
            // opens it while it is empty, and submits once it is set.
            returnKeyType={birthday ? 'go' : 'next'}
            onSubmitEditing={birthday ? submit : openBirthday}
            accessibilityLabel="Confirm password"
          />
        )}
      </form.AppField>

      <View>
        <MonoLabel color="textMid" style={styles.fieldLabel}>
          Birthday
        </MonoLabel>
        <Pressable
          onPress={openBirthday}
          accessibilityRole="button"
          accessibilityLabel={birthday ? `Birthday, ${formattedDate}` : 'Select your birthday'}
          style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed]}
        >
          <Text style={birthday ? styles.dateValue : styles.datePlaceholder}>
            {birthday ? formattedDate : 'Select your birthday'}
          </Text>
        </Pressable>
      </View>

      {showDatePicker && (
        <View style={styles.picker}>
          <DateTimePicker
            value={birthday ? new Date(birthday + 'T00:00:00') : new Date(2000, 0, 1)}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            onChange={onDateChange}
            themeVariant="light"
          />
          <Button variant="outline" size="sm" onPress={() => setShowDatePicker(false)} style={styles.pickerDone}>
            Done
          </Button>
        </View>
      )}

      {error ? <AuthFormError message={error} /> : null}

      <Text style={styles.terms}>
        By creating an account you agree to the terms of service and privacy policy.
      </Text>

      <Button fullWidth onPress={submit} loading={submitting} disabled={!canSubmit}>
        Create account
      </Button>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  outcome: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: color.bg,
  },
  fieldLabel: {
    marginBottom: space.sm,
  },
  // Drawn as a TextField, since it reads as one.
  dateField: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.none,
    backgroundColor: color.bgPanel,
  },
  dateFieldPressed: {
    borderColor: color.text,
  },
  dateValue: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  datePlaceholder: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMuted,
  },
  picker: {
    borderWidth: 1,
    borderColor: color.border,
    paddingBottom: space.md,
    alignItems: 'stretch',
  },
  pickerDone: {
    alignSelf: 'center',
  },
  terms: {
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 17,
    color: color.textMuted,
    textAlign: 'center',
  },
});
