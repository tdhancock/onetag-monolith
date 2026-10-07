import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ListRow, Sheet, SheetRow, TextField } from './ui';
import { SearchIcon } from './Icons';
import { RowSkeletons, SectionError } from './SectionStates';
import { PROFILE_SEARCH_MIN_LENGTH, useProfileSearchQuery } from '../../features/profiles';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import type { LogPerson } from '../../lib/screens/projectLog';
import { color, space, type } from '../../theme/tokens';

export interface LogPersonPickerProps {
  visible: boolean;
  /** Who is named now, so "No one" can say so. */
  current: LogPerson | null;
  onPick: (person: LogPerson | null) => void;
  onClose: () => void;
}

/**
 * Who did a log entry's work (ONE-141): any profile, business or individual,
 * found by handle as adding a Contributor finds one. A Sheet inside Add to
 * log, since a modal never pushes a screen.
 */
const LogPersonPicker: React.FC<LogPersonPickerProps> = ({ visible, current, onPick, onClose }) => (
  <Sheet visible={visible} onClose={onClose} title="Who did it">
    {/* Mounted only while open, so its search runs only then. */}
    {visible ? <PickerBody current={current} onPick={onPick} /> : null}
  </Sheet>
);

const PickerBody: React.FC<Pick<LogPersonPickerProps, 'current' | 'onPick'>> = ({ current, onPick }) => {
  const [query, setQuery] = useState('');
  const search = useProfileSearchQuery(useDebouncedValue(query));
  const searching = query.trim().length >= PROFILE_SEARCH_MIN_LENGTH;
  const results = searching ? search.data ?? [] : [];

  return (
    <View>
      <View style={styles.search}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search profiles by handle"
          autoCapitalize="none"
          autoCorrect={false}
          leading={<SearchIcon color={color.textMuted} size={18} />}
          accessibilityLabel="Search profiles"
        />
      </View>
      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {current ? <SheetRow label="No one" hint={`Take ${current.name} off this entry.`} onPress={() => onPick(null)} /> : null}
        {results.map((profile) => (
          <ListRow
            key={profile.id}
            title={profile.name}
            subtitle={`@${profile.username} · ${profile.profileType === 'business' ? 'Business' : 'Individual'}`}
            avatarUri={profile.avatarUrl}
            verified={profile.isVerified}
            accessibilityLabel={`Choose ${profile.name}, @${profile.username}`}
            onPress={() =>
              onPick({ id: profile.id, name: profile.name, username: profile.username, avatarUrl: profile.avatarUrl })
            }
          />
        ))}
        {searching && results.length === 0 ? (
          search.isFetching ? (
            <RowSkeletons count={2} />
          ) : search.isError ? (
            <SectionError message="Couldn't search profiles." onRetry={() => void search.refetch()} />
          ) : (
            <Text style={styles.hint}>No profile with that handle.</Text>
          )
        ) : null}
        {!searching ? <Text style={styles.hint}>The business or person who did the work.</Text> : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  results: {
    maxHeight: 360,
  },
  hint: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
});

export default LogPersonPicker;
