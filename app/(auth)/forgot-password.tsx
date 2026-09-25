import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../services/supabase.native';
import { Button, EmptyState, TextField } from '../../components/native/ui';
import AuthScaffold, { AuthFormError, AuthSwitch } from '../../components/native/AuthScaffold';
import { EnvelopeIcon } from '../../components/native/Icons';
import { resetFormValid } from '../../lib/screens/auth';
import { color } from '../../theme/tokens';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleResetPassword = async () => {
    if (loading) return;
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: 'onetag://reset-password',
        }
      );

      if (resetError) throw resetError;

      setSuccess(true);
    } catch (err: any) {
      console.error('[ForgotPassword] Error:', err);
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.outcome}>
        <EmptyState
          icon={<EnvelopeIcon color={color.text} size={48} strokeWidth={1.5} />}
          title="Check your email"
          body={`We sent a password reset link to ${email.trim()}. Open it to reset your password, then come back and sign in.`}
          action={{ label: 'Back to sign in', onPress: () => router.replace('/(auth)/login') }}
        />
      </SafeAreaView>
    );
  }

  return (
    <AuthScaffold
      subtitle="Reset your password"
      footer={
        <AuthSwitch prompt="Remember your password?" action="Sign in" onPress={() => router.push('/(auth)/login')} />
      }
    >
      <TextField
        label="Email"
        placeholder="Enter your email address"
        value={email}
        onChangeText={setEmail}
        textContentType="emailAddress"
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={handleResetPassword}
        accessibilityLabel="Email"
      />

      {error ? <AuthFormError message={error} /> : null}

      <Button fullWidth onPress={handleResetPassword} loading={loading} disabled={!resetFormValid(email)}>
        Send reset link
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
});
