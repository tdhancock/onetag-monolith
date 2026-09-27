import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ListRow, Sheet, TextField } from './ui';
import { SearchIcon } from './Icons';
import { useProfileSearchQuery } from '../../features/profiles';
import { useProductSearchQuery } from '../../features/products';
import { usePublicProjectSearchQuery } from '../../features/projects';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { pickerOptions } from '../../lib/screens/composeTags';
import { color, space, type } from '../../theme/tokens';
import type { EmbeddedTagDestination } from '../../types';

// What a tag in the composer points at (ONE-46): any profile, any product, or
// any public project — anyone's, not only the author's. Tagging another
// business's product in your photo is the point. Never a post (ONE-83).

export interface TagDestinationPickerProps {
  visible: boolean;
  onPick: (destination: EmbeddedTagDestination) => void;
  /** Closed without a choice. */
  onClose: () => void;
}

const TagDestinationPicker: React.FC<TagDestinationPickerProps> = ({ visible, onPick, onClose }) => (
  <Sheet visible={visible} onClose={onClose} title="Tag a profile, product or project">
    {/* Mounted only while open, so its searches run only then. */}
    {visible ? <PickerBody onPick={onPick} /> : null}
  </Sheet>
);

const PickerBody: React.FC<{ onPick: (destination: EmbeddedTagDestination) => void }> = ({ onPick }) => {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query);
  const profiles = useProfileSearchQuery(term);
  const products = useProductSearchQuery(term);
  const projects = usePublicProjectSearchQuery(term);

  const options = pickerOptions(profiles.data ?? [], products.data ?? [], projects.data ?? []);
  const failed = profiles.isError && products.isError && projects.isError;

  return (
    <View style={styles.body}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search profiles, products and projects"
        leading={<SearchIcon color={color.textMuted} size={18} />}
        containerStyle={styles.search}
      />
      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {options.map((option) => (
          <ListRow
            key={option.key}
            title={option.destination.name}
            subtitle={option.subtitle}
            avatarUri={option.destination.imageUrl}
            onPress={() => onPick(option.destination)}
            accessibilityLabel={`Tag ${option.destination.name}, ${option.subtitle}`}
          />
        ))}
        {options.length === 0 ? (
          <Text style={styles.empty}>
            {failed ? 'Search didn’t load. Check your connection.' : 'Nothing found. Try another name.'}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingBottom: space.sm,
  },
  search: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  results: {
    maxHeight: 360,
  },
  empty: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMuted,
  },
});

export default TagDestinationPicker;
