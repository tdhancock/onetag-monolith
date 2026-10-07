import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ListRow, MonoLabel } from './ui';
import { CheckIcon } from './Icons';
import type { DestinationSection, DraftDestination } from '../../lib/screens/tags';
import { color, space } from '../../theme/tokens';

export interface OwnedDestinationListProps {
  sections: DestinationSection[];
  selected: DraftDestination | null;
  onSelect: (destination: DraftDestination) => void;
}

/**
 * The destinations a Physical or Digital Tag may point at, one section a
 * kind, the chosen one ticked: the create flow's destination step (ONE-32)
 * and linking a blank tag (ONE-139). The sections come from
 * lib/useOwnedTagDestinations.ts — only what the account owns.
 */
const OwnedDestinationList: React.FC<OwnedDestinationListProps> = ({ sections, selected, onSelect }) => (
  <View style={styles.sections}>
    {sections.map((section) => (
      <View key={section.kind}>
        <MonoLabel color="textMid" style={styles.sectionTitle}>
          {section.title}
        </MonoLabel>
        {section.options.map((option, index) => {
          const isSelected =
            selected?.kind === option.destination.kind && selected.id === option.destination.id;
          return (
            <ListRow
              key={option.destination.id}
              title={option.title}
              subtitle={option.subtitle}
              avatarUri={option.avatarUri}
              // A product's or project's picture is square; a profile's avatar round.
              leading={
                option.imageUri !== undefined ? (
                  option.imageUri ? (
                    <Image source={{ uri: option.imageUri }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={styles.thumb} />
                  )
                ) : undefined
              }
              divider={index < section.options.length - 1}
              onPress={() => onSelect(option.destination)}
              accessibilityLabel={`${option.title}${isSelected ? ', selected' : ''}`}
              trailing={isSelected ? <CheckIcon color={color.text} size={20} strokeWidth={2} /> : null}
            />
          );
        })}
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  sections: {
    marginTop: space.lg,
    gap: space.lg,
  },
  sectionTitle: {
    marginBottom: space.xs,
  },
  thumb: {
    width: 40,
    height: 40,
    backgroundColor: color.bgPanel,
  },
});

export default OwnedDestinationList;
