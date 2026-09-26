import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Pressable } from './ui';
import { color, space, type } from '../../theme/tokens';

export interface ModalHeaderProps {
  title: string;
  /** Omitted on a screen whose only exit is its action, such as a picker's Done. */
  onCancel?: () => void;
  onSave: () => void;
  /** Save stays greyed out and inert until there is something valid to save. */
  canSave: boolean;
  /** A save is under way: a spinner stands in for Save. */
  saving?: boolean;
  /** Defaults to Save. */
  saveLabel?: string;
}

/**
 * The bar across the top of a form presented as a modal: Cancel, the title,
 * and Save — the layout Edit profile uses, for the product and project forms
 * and the project's picker (ONE-40, ONE-41).
 */
const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onCancel,
  onSave,
  canSave,
  saving = false,
  saveLabel = 'Save',
}) => (
  <View style={styles.header}>
    {onCancel ? (
      <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={12} style={styles.side}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    ) : (
      <View style={styles.side} />
    )}
    <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
      {title}
    </Text>
    <View style={[styles.side, styles.right]}>
      {saving ? (
        <ActivityIndicator size="small" color={color.text} accessibilityLabel="Saving" />
      ) : (
        <Pressable
          onPress={canSave ? onSave : undefined}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={saveLabel}
          accessibilityState={{ disabled: !canSave }}
          hitSlop={12}
        >
          <Text style={[styles.save, !canSave && styles.saveDisabled]}>{saveLabel}</Text>
        </Pressable>
      )}
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  side: {
    minWidth: 64,
  },
  right: {
    alignItems: 'flex-end',
  },
  cancel: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  title: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  save: {
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: color.text,
  },
  saveDisabled: {
    color: color.textMuted,
  },
});

export default ModalHeader;
