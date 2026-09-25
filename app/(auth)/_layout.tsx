

import { Stack } from 'expo-router';
import { color } from '../../theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        // As in the root stack: white before the screen paints, never black.
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
