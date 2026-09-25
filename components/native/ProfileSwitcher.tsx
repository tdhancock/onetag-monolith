import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile, useMyProfilesQuery, useSetActiveProfile, asProfileId } from '../../features/profiles';
import type { UserProfile } from '../../features/profiles';
import { Avatar, Divider, MonoLabel, Pressable, Sheet } from './ui';
import { CheckIcon, ChevronDownIcon, PlusIcon } from './Icons';
import { canAddProfile, profileKindLabel, switcherRowLabel } from '../../lib/screens/profile';
import { color, space, type } from '../../theme/tokens';

/** A switcher row's minimum height: over the 44pt target, room for two lines. */
export const SWITCHER_ROW_HEIGHT = 64;

// ─── The sheet ────────────────────────────────────────────────────────

export interface ProfileSwitcherProps {
  visible: boolean;
  onClose: () => void;
  /** "Add a Profile": the screen routes to the create-profile flow. */
  onAddProfile: () => void;
}

/** One profile the account owns: avatar, name, handle, its kind, and whether it is active. */
const ProfileRow: React.FC<{ profile: UserProfile; isActive: boolean; onPress: () => void }> = ({
  profile,
  isActive,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={switcherRowLabel(profile, isActive)}
    accessibilityState={{ selected: isActive }}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    <Avatar uri={profile.profilePicture} name={profile.name || profile.username} size={40} />
    <View style={styles.rowText}>
      <Text style={styles.name} numberOfLines={1}>
        {profile.name || profile.username}
      </Text>
      <Text style={styles.handle} numberOfLines={1}>
        @{profile.username}
      </Text>
      <MonoLabel style={styles.kind}>{profileKindLabel(profile.profileType)}</MonoLabel>
    </View>
    {/* Marked by a check and a word, never by colour alone. */}
    {isActive ? (
      <View style={styles.active}>
        <MonoLabel color="text">Active</MonoLabel>
        <CheckIcon color={color.text} size={20} strokeWidth={2} />
      </View>
    ) : null}
  </Pressable>
);

/**
 * Every profile the account owns, the one it is acting as marked, and — while
 * it lacks a kind — a way to add one (ONE-25).
 *
 * Tapping another profile switches to it and closes the sheet; the switch
 * resets whatever was cached for the previous profile, so screens behind it
 * show their loading state rather than the old identity's content.
 */
const ProfileSwitcher: React.FC<ProfileSwitcherProps> = ({ visible, onClose, onAddProfile }) => {
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const { data: profiles = [] } = useMyProfilesQuery(authUserId);
  const setActiveProfile = useSetActiveProfile();

  const choose = (profile: UserProfile) => {
    onClose();
    if (profile.id === profileId) return;
    setActiveProfile.mutate(asProfileId(profile.id), {
      onError: () => addToast(`Could not switch to @${profile.username}.`, 'error'),
    });
  };

  const addProfile = () => {
    onClose();
    onAddProfile();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Your profiles">
      {profiles.map(profile => (
        <ProfileRow
          key={profile.id}
          profile={profile}
          isActive={profile.id === profileId}
          onPress={() => choose(profile)}
        />
      ))}
      {canAddProfile(profiles) ? (
        <>
          <Divider />
          <Pressable
            onPress={addProfile}
            accessibilityRole="button"
            accessibilityLabel="Add a Profile"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.addIcon}>
              <PlusIcon color={color.text} size={20} strokeWidth={1.8} />
            </View>
            <Text style={styles.addLabel}>Add a Profile</Text>
          </Pressable>
        </>
      ) : null}
    </Sheet>
  );
};

// ─── The entry point ──────────────────────────────────────────────────

export interface ProfileSwitcherButtonProps {
  profile: Pick<UserProfile, 'username' | 'name' | 'profilePicture'>;
  onPress: () => void;
}

/**
 * The acting profile's avatar and handle with a chevron, for a screen's top
 * bar — which profile you are acting as, visible without opening anything,
 * and the way into the switcher.
 */
export const ProfileSwitcherButton: React.FC<ProfileSwitcherButtonProps> = ({ profile, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Acting as @${profile.username}. Switch profile`}
    hitSlop={8}
    style={({ pressed }) => [styles.entry, pressed && styles.entryPressed]}
  >
    <Avatar uri={profile.profilePicture} name={profile.name || profile.username} size={28} />
    <Text style={styles.entryHandle} numberOfLines={1}>
      @{profile.username}
    </Text>
    <ChevronDownIcon color={color.text} size={18} strokeWidth={2} />
  </Pressable>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: SWITCHER_ROW_HEIGHT,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  rowPressed: {
    backgroundColor: color.bgSub,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  handle: {
    marginTop: 1,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  kind: {
    marginTop: space.xs,
  },
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  addIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
  },
  addLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.text,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
    minHeight: 44,
  },
  entryPressed: {
    opacity: 0.6,
  },
  entryHandle: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
});

export default ProfileSwitcher;
