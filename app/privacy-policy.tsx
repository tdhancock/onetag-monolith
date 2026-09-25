import React from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import LegalDocument, { type LegalBlock } from '../components/native/LegalDocument';
import { color } from '../theme/tokens';

const BLOCKS: LegalBlock[] = [
  {
    kind: 'paragraph',
    text: 'At OneTag, we take your privacy seriously. This policy describes how we collect, use, and share your personal information when you use our mobile application.',
  },
  { kind: 'heading', text: '1. Information We Collect' },
  {
    kind: 'paragraph',
    text: 'We collect information you provide directly to us, such as when you create or modify your account, request on-demand services, contact customer support, or otherwise communicate with us.',
  },
  { kind: 'heading', text: 'Copyright Notice' },
  { kind: 'paragraph', text: '© 2026 OneTag. All rights reserved.' },
  {
    kind: 'paragraph',
    text: 'Licensed under the Apache License, Version 2.0. You may obtain a copy of the license at http://www.apache.org/licenses/LICENSE-2.0',
  },
  { kind: 'note', text: 'Source code available at: github.com/sametyilmaztemel/onetag-monolith' },
];

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Privacy Policy' }} />
      <LegalDocument title="Privacy Policy" lastUpdated="April 4, 2026" blocks={BLOCKS} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
});
