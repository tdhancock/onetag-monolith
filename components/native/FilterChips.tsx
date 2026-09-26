import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button } from './ui';
import { space } from '../../theme/tokens';

export interface FilterChipsProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  /** Names the group for a screen reader: "Type", "Show". */
  label: string;
}

/**
 * One row of filter chips: the selected one solid, the rest outlined. The
 * Tags dashboard's filters (ONE-34), and a profile's Saves filter and
 * Owned/Contributed toggle (ONE-43).
 */
function FilterChips<T extends string>({ options, selected, onSelect, label }: FilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === selected ? 'primary' : 'outline'}
          onPress={() => onSelect(option.value)}
          accessibilityLabel={`${label}: ${option.label}${option.value === selected ? ', selected' : ''}`}
        >
          {option.label}
        </Button>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: {
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
});

export default FilterChips;
