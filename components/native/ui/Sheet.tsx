import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { color, radius, space, type } from '../../../theme/tokens';
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
export const SheetRow: React.FC<SheetRowProps> = ({ label, icon, destructive = false, chevron = false, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
    <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
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
  rowPressed: {
    backgroundColor: color.bgSub,
  },
  rowIcon: {
    marginRight: space.md,
  },
  rowLabel: {
    flex: 1,
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
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
