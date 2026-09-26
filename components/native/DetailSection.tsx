import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MonoLabel } from './ui';
import { color, space } from '../../theme/tokens';

export interface DetailSectionProps {
  /** The MonoLabel heading: "Specs", "Used in projects". */
  title: string;
  /** Right of the heading: a count, or an owner's "Add". */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * One section of a Product or Project page (ONE-40, ONE-41): a hairline
 * above, a mono heading, and its rows.
 */
const DetailSection: React.FC<DetailSectionProps> = ({ title, trailing, children }) => (
  <View style={styles.section} accessibilityLabel={title}>
    <View style={styles.heading}>
      <MonoLabel color="textMid">{title}</MonoLabel>
      {trailing ?? null}
    </View>
    {children}
  </View>
);

const styles = StyleSheet.create({
  section: {
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingBottom: space.sm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
});

export default DetailSection;
