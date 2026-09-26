import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Skeleton } from './ui';
import { color, space, type } from '../../theme/tokens';

/** ListRow-shaped placeholders while a section or a picker's list loads. */
export const RowSkeletons: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <View accessibilityLabel="Loading">
    {Array.from({ length: count }, (_, i) => (
      <View key={i} style={styles.row}>
        <Skeleton circle height={40} />
        <View style={styles.text}>
          <Skeleton width={140} height={12} />
          <Skeleton width={90} height={10} style={styles.gap} />
        </View>
      </View>
    ))}
  </View>
);

/**
 * What a section of a page, or a picker, says when its read failed: a short
 * message and a way to try again — never an empty state that would claim
 * there is nothing there.
 */
export const SectionError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <View style={styles.error}>
    <Text style={styles.message}>{message}</Text>
    <Button variant="outline" size="sm" onPress={onRetry} style={styles.retry}>
      Try again
    </Button>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  text: {
    flex: 1,
    marginLeft: space.md,
  },
  gap: {
    marginTop: space.sm,
  },
  error: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  message: {
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  retry: {
    marginTop: space.sm,
    alignSelf: 'flex-start',
  },
});
