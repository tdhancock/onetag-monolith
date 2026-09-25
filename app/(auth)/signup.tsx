import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, Keyboard, StyleSheet } from 'react-native';
import type { TextInput } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../services/supabase.native';
import { ensureCurrentUserProfile } from '../../services/profileBootstrap';
import { checkUsernameExists } from '../../features/profiles';
import { usernameError as usernameRuleError } from '../../lib/screens/profile';
import {
  USERNAME_CHECK_DEBOUNCE_MS,
  signupFormValid,
  signupPasswordErrors,
  usernameAvailabilityLabel,
  type UsernameAvailability,
} from '../../lib/screens/auth';
import { Button, EmptyState, MonoLabel, Pressable, TextField } from '../../components/native/ui';
import AuthScaffold, { AuthFormError, AuthSwitch, PasswordField } from '../../components/native/AuthScaffold';
import { EnvelopeIcon } from '../../components/native/Icons';
import { color, radius, space, type } from '../../theme/tokens';

/** The status inside the username field: a spinner, then Available or Taken. */
const UsernameStatus: React.FC<{ status: UsernameAvailability }> = ({ status }) => {
  if (status === 'checking') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={color.textMuted} accessibilityLabel="Checking username" />
      </View>
    );
  }
  const label = usernameAvailabilityLabel(status);
  if (!label) return null;
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <Text style={[styles.statusLabel, status === 'taken' && styles.statusTaken]}>{label}</Text>
    </View>
  );
};

export default function SignupScreen() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameAvailability>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState<{ password?: boolean; confirmPassword?: boolean }>({});
  const [birthday, setBirthday] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleUsernameChange = (value: string) => {
    const lower = value.toLowerCase();
    setUsername(lower);
    // The rule Edit profile applies too (lib/screens/profile).
    setUsernameError(usernameRuleError(lower) ?? '');
  };

  // Look the username up once typing pauses, so "Taken" shows inside the
  // field before the form is sent. The submit still checks again.
  useEffect(() => {
    if (!username || usernameError) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const taken = await checkUsernameExists(username);
        if (!cancelled) setUsernameStatus(taken ? 'taken' : 'available');
      } catch {
        if (!cancelled) setUsernameStatus('unknown');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, usernameError]);

  const fieldErrors = signupPasswordErrors({ password, confirmPassword }, touched);

  const isFormValid = signupFormValid({
    fullName,
    username,
    usernameError: usernameError || null,
    usernameStatus,
    email,
    password,
    confirmPassword,
    birthday,
  });

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
      const iso = selectedDate.toISOString().slice(0, 10); // YYYY-MM-DD
      setBirthday(iso);
    }
  };

  const handleSignUp = async () => {
    if (loading || usernameError) return;

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!isFormValid) {
      setError('Please fill out all fields correctly.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const isTaken = await checkUsernameExists(username);
      if (isTaken) {
        setUsernameStatus('taken');
        throw new Error('This username is already taken.');
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: username,
            birthday: birthday,
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
        return;
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during sign up.');
    } finally {
      setLoading(false);
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
      <TextField
        label="Full name"
        placeholder="Your name"
        value={fullName}
        onChangeText={setFullName}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => usernameRef.current?.focus()}
        accessibilityLabel="Full name"
      />

      <TextField
        ref={usernameRef}
        label="Username"
        placeholder="Pick a username"
        value={username}
        onChangeText={handleUsernameChange}
        error={usernameError || null}
        trailing={<UsernameStatus status={usernameStatus} />}
        textContentType="username"
        autoComplete="username-new"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailRef.current?.focus()}
        accessibilityLabel="Username"
      />

      <TextField
        ref={emailRef}
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
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

      <PasswordField
        ref={passwordRef}
        label="Password"
        placeholder="At least 6 characters"
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched(t => ({ ...t, password: true }))}
        error={fieldErrors.password}
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmRef.current?.focus()}
        accessibilityLabel="Password"
      />

      <PasswordField
        ref={confirmRef}
        label="Confirm password"
        placeholder="Type it again"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        onBlur={() => setTouched(t => ({ ...t, confirmPassword: true }))}
        error={fieldErrors.confirmPassword}
        textContentType="newPassword"
        autoComplete="new-password"
        // The birthday is a picker, not a keyboard field: the last text field
        // opens it while it is empty, and submits once it is set.
        returnKeyType={birthday ? 'go' : 'next'}
        onSubmitEditing={birthday ? handleSignUp : openBirthday}
        accessibilityLabel="Confirm password"
      />

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

      <Button fullWidth onPress={handleSignUp} loading={loading} disabled={!isFormValid}>
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
  status: {
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: space.sm,
  },
  statusLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    color: color.textMid,
  },
  statusTaken: {
    color: color.heart,
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
