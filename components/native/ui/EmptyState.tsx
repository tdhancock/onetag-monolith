import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, space, type } from '../../../theme/tokens';
import Button from './Button';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  /** An icon element drawn above the title. */
  icon?: React.ReactNode;
  title: string;
  /** One line of body copy. */
  body?: string;
  /** The single next step the screen offers. */
  action?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
}

/**
 * What a screen shows when it has nothing to list: an optional icon, a title,
 * one line of body and at most one action.
 *
 * One action, not several, is the point: every empty page offers somewhere to
 * go next (Waterfall Discovery), and a single clear step does that better
 * than a menu of them.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, body, action, style }) => (
  <View style={[styles.base, style]}>
    {icon ? <View style={styles.icon}>{icon}</View> : null}
    <Text style={styles.title}>{title}</Text>
    {body ? <Text style={styles.body}>{body}</Text> : null}
    {action ? (
      <Button variant="primary" onPress={action.onPress} style={styles.action}>
        {action.label}
      </Button>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
  },
  icon: {
    marginBottom: space.lg,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
    textAlign: 'center',
  },
  body: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMid,
    textAlign: 'center',
  },
  action: {
    marginTop: space.xl,
  },
});

export default EmptyState;
