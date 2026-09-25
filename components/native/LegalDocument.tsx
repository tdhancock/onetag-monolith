import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { MonoLabel } from './ui';
import { color, space, type } from '../../theme/tokens';

/** One piece of a legal page, in reading order. */
export type LegalBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  /** Small print, such as where the source lives. */
  | { kind: 'note'; text: string };

export interface LegalDocumentProps {
  title: string;
  /** Shown as a mono "Last updated …" line under the title. */
  lastUpdated?: string;
  blocks: readonly LegalBlock[];
}

/** Past this width a line of body copy stops being comfortable to read. */
export const LEGAL_MAX_WIDTH = 640;

/**
 * Long-form legal text laid out for reading: a bold title, the date it was
 * last changed, and body paragraphs at 15/24 under bold section headings.
 */
const LegalDocument: React.FC<LegalDocumentProps> = ({ title, lastUpdated, blocks }) => (
  <ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.column}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {lastUpdated ? (
        <MonoLabel color="textMuted" style={styles.updated}>
          Last updated {lastUpdated}
        </MonoLabel>
      ) : null}
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <Text key={i} style={styles.heading} accessibilityRole="header">
              {block.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={block.kind === 'note' ? styles.note : styles.paragraph}>
            {block.text}
          </Text>
        );
      })}
    </View>
  </ScrollView>
);

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: LEGAL_MAX_WIDTH,
    alignSelf: 'center',
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 22,
    lineHeight: 28,
    color: color.text,
  },
  updated: {
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  heading: {
    marginTop: space.lg,
    marginBottom: space.sm,
    fontFamily: type.bodyBold,
    fontSize: 17,
    lineHeight: 24,
    color: color.text,
  },
  paragraph: {
    marginBottom: space.md,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 24,
    color: color.text,
  },
  note: {
    marginBottom: space.md,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 20,
    color: color.textMid,
  },
});

export default LegalDocument;
