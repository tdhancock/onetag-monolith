import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, IconButton } from './ui';
import { XIcon } from './Icons';
import { color, space, type } from '../../theme/tokens';

export interface ModalHeaderProps {
  title: string;
  /** The X on the left. Omitted on a screen whose only exit is its action, such as a picker's Done. */
  onClose?: () => void;
  /** The action on the right. Omitted on a screen whose action sits in its content, below the form. */
  onSave?: () => void;
  /** The action stays dimmed and inert until there is something valid to save. */
  canSave?: boolean;
  /** A save is under way: a spinner stands in for the label. */
  saving?: boolean;
  /** Defaults to Save. Post, Add and Done are the others. */
  saveLabel?: string;
}

/** Each side's minimum width: the widest action, a four-letter label on a small Button. */
const SIDE_MIN_WIDTH = 64;

/**
 * The bar across the top of every screen presented as a modal: an X to close,
 * the title in the middle, and the screen's action as a small ink Button.
 * One bar, so every screen that slides up opens the same way — Compose's
 * Post is the model the rest follow.
 */
const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onClose,
  onSave,
  canSave = true,
  saving = false,
  saveLabel = 'Save',
}) => (
  <View style={styles.header}>
    <View style={styles.side}>
      {onClose ? (
        <IconButton
          icon={<XIcon color={color.text} size={22} strokeWidth={1.8} />}
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.close}
        />
      ) : null}
    </View>
    <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
      {title}
    </Text>
    <View style={[styles.side, styles.right]}>
      {onSave ? (
        <Button
          size="sm"
          onPress={onSave}
          // At full strength while saving: under way, not unavailable.
          disabled={!canSave && !saving}
          loading={saving}
          accessibilityLabel={saveLabel}
        >
          {saveLabel}
        </Button>
      ) : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  // Both sides hold the same width, so the title stays in the middle of the
  // bar whichever of them is empty.
  side: {
    minWidth: SIDE_MIN_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
  },
  right: {
    justifyContent: 'flex-end',
  },
  // The X's 44pt target runs out to the screen's edge, so the glyph itself
  // lines up with the 16pt gutter the content below keeps.
  close: {
    marginLeft: -space.lg,
  },
  title: {
    flex: 1,
    marginHorizontal: space.sm,
    textAlign: 'center',
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
});

export default ModalHeader;
