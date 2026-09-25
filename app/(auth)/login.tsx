import React, { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../services/supabase.native';
import { ensureCurrentUserProfile } from '../../services/profileBootstrap';
import { Button, TextField } from '../../components/native/ui';
import AuthScaffold, { AuthFormError, AuthLink, AuthSwitch, PasswordField } from '../../components/native/AuthScaffold';
import { loginFormValid } from '../../lib/screens/auth';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = loginFormValid(identifier, password);

  const handleLogin = async () => {
    if (loading) return;
    if (!identifier || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let email = identifier;

      // If identifier is not an email, assume it's a username and look up email
      if (!identifier.includes('@')) {
        const { data, error: rpcError } = await supabase.rpc('get_email_by_username', {
          p_username: identifier.toLowerCase()
        });

        if (rpcError || !data) {
          throw new Error(rpcError?.message || 'Username not found');
        }
        email = data;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (signInError) throw signInError;

      const profileReady = await ensureCurrentUserProfile();
      if (!profileReady) {
        console.warn('[Login] Profile row missing and auto-create failed. Some features may not work.');
      }

      // router.replace('/(tabs)') handled by _layout's listener
    } catch (err: any) {
      console.error('[Login] Error:', err);
      setError(err.message || 'An error occurred during login');
      setLoading(false);
    }
  };

  return (
    <AuthScaffold
      subtitle="Sign in to continue"
      footer={
        <AuthSwitch prompt="New here?" action="Create an account" onPress={() => router.push('/(auth)/signup')} />
      }
    >
      <TextField
        label="Email or username"
        placeholder="Enter your email or username"
        value={identifier}
        onChangeText={setIdentifier}
        // `username` is the account-identifier hint on both platforms, which
        // is what lets a password manager fill this and the password together.
        textContentType="username"
        autoComplete="username"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        accessibilityLabel="Email or username"
      />
      <PasswordField
        ref={passwordRef}
        label="Password"
        placeholder="Enter your password"
        value={password}
        onChangeText={setPassword}
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={handleLogin}
        accessibilityLabel="Password"
      />

      {error ? <AuthFormError message={error} /> : null}

      <Button fullWidth onPress={handleLogin} loading={loading} disabled={!canSubmit}>
        Sign in
      </Button>

      <AuthLink label="Forgot password?" onPress={() => router.push('/(auth)/forgot-password')} />
    </AuthScaffold>
  );
}
