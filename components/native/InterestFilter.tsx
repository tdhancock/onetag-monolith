import React from 'react';
import { View, StyleSheet } from 'react-native';
import FilterChips from './FilterChips';
import { useInterestsQuery } from '../../features/interests';
import { space } from '../../theme/tokens';

// A horizontal row of interest chips (ONE-49): the Feed's and Explore's
// filter, leading with "All", and the composer's optional choice, leading
// with "None". The selection is the screen's view state — never stored, so
// it resets on launch rather than quietly narrowing a feed for weeks.

export interface InterestFilterProps {
  /** An interest slug, or null for the leading option. */
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /** The leading option's label: "All" for a filter, "None" for a choice. */
  leadingLabel?: string;
  /** Names the group for a screen reader. */
  label?: string;
}

/** FilterChips needs a string for every option; the leading one is empty. */
const LEADING = '';

const InterestFilter: React.FC<InterestFilterProps> = ({
  selected,
  onSelect,
  leadingLabel = 'All',
  label = 'Interest',
}) => {
  const { data: interests } = useInterestsQuery();
  // Until the list arrives there is nothing to choose, and no row at all —
  // never a row of one "All" chip.
  if (!interests || interests.length === 0) return null;

  const options = [{ value: LEADING, label: leadingLabel }, ...interests.map((i) => ({ value: i.slug, label: i.name }))];

  return (
    <View style={styles.row} testID="interest-filter">
      <FilterChips
        label={label}
        options={options}
        selected={selected ?? LEADING}
        onSelect={(value) => onSelect(value === LEADING ? null : value)}
      />
    </View>
  );
};

/** The display name of an interest slug, for an empty state; the slug itself if unknown. */
export const useInterestName = (slug: string | null): string | null => {
  const { data: interests } = useInterestsQuery();
  if (!slug) return null;
  return interests?.find((i) => i.slug === slug)?.name ?? slug;
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.sm,
  },
});

export default InterestFilter;
