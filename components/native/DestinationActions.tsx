import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from './ui';
import { useCurrentProfile } from '../../features/profiles';
import { useIsSaved, useToggleSave, type SaveTarget } from '../../features/saves';
import { shareDestination } from '../../services/destinationSharing';
import { space } from '../../theme/tokens';

export interface DestinationActionsProps {
  /** What Save bookmarks: this product or project. */
  target: SaveTarget;
  /** Its name, the first thing a shared link says. */
  title: string;
  /** Its route in the app, which the shared link opens. */
  route: string;
}

/**
 * Save and Share, side by side, on a Product or a Project page (ONE-40,
 * ONE-41).
 *
 * Saving belongs to a profile, so someone without one — a stranger who
 * scanned a tag — is offered a way in instead of a Save that can only fail.
 * Share needs no account: anyone can pass a page on.
 */
const DestinationActions: React.FC<DestinationActionsProps> = ({ target, title, route }) => {
  const router = useRouter();
  const { profileId, status } = useCurrentProfile();
  const saved = useIsSaved(profileId, target);
  const save = useToggleSave(profileId);

  const share = () => void shareDestination({ title, route }).catch(() => undefined);

  return (
    <View style={styles.row}>
      {status === 'signed-out' ? (
        <Button variant="outline" size="sm" onPress={() => router.push('/(auth)/signup')} style={styles.action}>
          Sign up to save
        </Button>
      ) : (
        <Button
          variant={saved ? 'primary' : 'outline'}
          size="sm"
          onPress={() => save.toggle(target)}
          disabled={!profileId}
          accessibilityLabel={saved ? `Saved. Remove ${title} from your saves` : `Save ${title}`}
          style={styles.action}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      )}
      <Button variant="outline" size="sm" onPress={share} accessibilityLabel={`Share ${title}`} style={styles.action}>
        Share
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  action: {
    flex: 1,
  },
});

export default DestinationActions;
