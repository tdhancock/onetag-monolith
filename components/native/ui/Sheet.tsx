import React from 'react';
import { View, Text, Modal, StyleSheet } from 'react-native';
import { color, radius, space, type } from '../../../theme/tokens';
import Pressable from './Pressable';
import Button from './Button';
import IconButton from './IconButton';
import { ArrowLeftIcon, ChevronRightIcon } from '../Icons';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** A heading row above the content, e.g. "Why are you reporting this?". */
  title?: string;
  /** Adds a back arrow to the heading, for a second step inside one sheet. */
  onBack?: () => void;
  children: React.ReactNode;
}

export interface SheetRowProps {
  label: string;
  /** A second line under the label saying what the action does. */
  hint?: string;
  icon?: React.ReactNode;
  /** Heart red, for Delete, Block, Report. */
  destructive?: boolean;
  /** A trailing chevron: the row leads to another step. */
  chevron?: boolean;
  onPress: () => void;
}

/** A sheet row's minimum height, in points. */
export const SHEET_ROW_HEIGHT = 56;

/**
 * A bottom sheet of actions: white, a hairline along its top, 56pt rows, and
 * an outline Cancel. Tapping the scrim closes it too.
 */
const Sheet: React.FC<SheetProps> = ({ visible, onClose, title, onBack, children }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.root}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={styles.sheet}>
        {title ? (
          <View style={[styles.titleRow, !onBack && styles.titleRowPlain]}>
            {onBack ? (
              <IconButton
                icon={<ArrowLeftIcon color={color.text} size={20} />}
                accessibilityLabel="Back"
                onPress={onBack}
              />
            ) : null}
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          </View>
        ) : null}
        {children}
        <Button variant="outline" onPress={onClose} style={styles.cancel}>
          Cancel
        </Button>
      </View>
    </View>
  </Modal>
);

/** One action in a Sheet. */
export const SheetRow: React.FC<SheetRowProps> = ({ label, hint, icon, destructive = false, chevron = false, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    onPress={onPress}
    style={({ pressed }) => [styles.row, hint ? styles.rowWithHint : null, pressed && styles.rowPressed]}
  >
    {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
    <View style={styles.rowText}>
      <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
    </View>
    {chevron ? <ChevronRightIcon color={color.textMuted} size={18} /> : null}
  </Pressable>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    backgroundColor: color.text,
    opacity: 0.4,
  },
  sheet: {
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SHEET_ROW_HEIGHT,
    paddingHorizontal: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  titleRowPlain: {
    paddingHorizontal: space.xl,
  },
  title: {
    marginLeft: space.xs,
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: color.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SHEET_ROW_HEIGHT,
    paddingHorizontal: space.xl,
  },
  // A hinted row is two lines, so it grows past the 56pt minimum.
  rowWithHint: {
    minHeight: 72,
    paddingVertical: space.md,
  },
  rowPressed: {
    backgroundColor: color.bgSub,
  },
  rowText: {
    flex: 1,
  },
  rowIcon: {
    marginRight: space.md,
  },
  rowLabel: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  rowHint: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  destructive: {
    color: color.heart,
  },
  cancel: {
    marginTop: space.md,
    marginHorizontal: space.xl,
  },
});

export default Sheet;
