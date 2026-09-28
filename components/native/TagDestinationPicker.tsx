import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ListRow, Sheet, TextField } from './ui';
import { SearchIcon } from './Icons';
import {
  usePostResultsQuery,
  useProfileResultsQuery,
  useProductResultsQuery,
  useProjectResultsQuery,
} from '../../features/search';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { pickerOptions } from '../../lib/screens/composeTags';
import { color, space, type } from '../../theme/tokens';
import type { EmbeddedTagDestination } from '../../types';

// What a tag in the composer points at (ONE-46): any profile, any product,
// any public project or any post — anyone's, not only the author's. Tagging
// another business's product in your photo is the point.
//
// Through the search functions (ONE-48), which leave out accounts blocked
// either way — a block prevents a tag (ONE-93), so the picker never offers
// one the database would refuse.

export interface TagDestinationPickerProps {
  visible: boolean;
  onPick: (destination: EmbeddedTagDestination) => void;
  /** Closed without a choice. */
  onClose: () => void;
  /** The post the photo is on, when editing one: never offered as its own tag. */
  hostPostId?: string | null;
}

const TagDestinationPicker: React.FC<TagDestinationPickerProps> = ({ visible, onPick, onClose, hostPostId }) => (
  <Sheet visible={visible} onClose={onClose} title="Tag a profile, product, project or post">
    {/* Mounted only while open, so its searches run only then. */}
    {visible ? <PickerBody onPick={onPick} hostPostId={hostPostId} /> : null}
  </Sheet>
);

const PickerBody: React.FC<{ onPick: (destination: EmbeddedTagDestination) => void; hostPostId?: string | null }> = ({
  onPick,
  hostPostId,
}) => {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query);
  const profiles = useProfileResultsQuery(term);
  const products = useProductResultsQuery(term, null);
  const projects = useProjectResultsQuery(term, null, true);
  const posts = usePostResultsQuery(term);

  const options = pickerOptions(
    profiles.data ?? [],
    products.data ?? [],
    (projects.data ?? []).map((p) => ({ id: p.id, name: p.name, coverUrl: p.coverUrl, isPublic: true })),
    (posts.data ?? []).map((p) => ({ id: p.id, content: p.content, imageUrl: p.imageUrl, authorUsername: p.authorUsername })),
    hostPostId,
  );
  const failed = profiles.isError && products.isError && projects.isError && posts.isError;

  return (
    <View style={styles.body}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search profiles, products, projects and posts"
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
            {failed
              ? 'Search didn’t load. Check your connection.'
              : term.trim()
                ? 'Nothing found. Try another name.'
                : 'Search for a profile, product, project or post.'}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  // Shrinks with the sheet when the keyboard is up, so the search stays in view.
  body: {
    flexShrink: 1,
    paddingBottom: space.sm,
  },
  search: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  results: {
    flexShrink: 1,
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
