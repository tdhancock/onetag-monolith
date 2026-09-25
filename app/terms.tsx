import React from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import LegalDocument, { type LegalBlock } from '../components/native/LegalDocument';
import { color } from '../theme/tokens';

const BLOCKS: LegalBlock[] = [
  { kind: 'paragraph', text: 'By using OneTag, you agree to these terms. Please read them carefully.' },
  { kind: 'heading', text: '1. Using our Services' },
  {
    kind: 'paragraph',
    text: 'You must follow any policies made available to you within the Services. Do not misuse our Services. For example, do not interfere with our Services or try to access them using a method other than the interface and the instructions that we provide.',
  },
  { kind: 'heading', text: 'Intellectual Property' },
  { kind: 'paragraph', text: '© 2026 OneTag. All rights reserved.' },
  {
    kind: 'paragraph',
    text: 'The source code is licensed under the Apache License, Version 2.0. You may use, reproduce, and distribute it in accordance with the license terms available at http://www.apache.org/licenses/LICENSE-2.0',
  },
  { kind: 'note', text: 'Source code: github.com/sametyilmaztemel/onetag-monolith' },
];

export default function TermsOfServiceScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Terms of Service' }} />
      <LegalDocument title="Terms of Service" lastUpdated="April 4, 2026" blocks={BLOCKS} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
});
