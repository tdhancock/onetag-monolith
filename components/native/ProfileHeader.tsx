import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Avatar, Skeleton } from './ui';
import { VerifiedIcon } from './Icons';
import RenderUserContent from './RenderUserContent';
import { getBioText, getStatCell, PROFILE_STAT_COLUMNS, type ProfileStats } from '../../lib/screens/profile';
import { color, space, type } from '../../theme/tokens';

export interface ProfileHeaderProfile {
  username: string;
  name?: string;
  bio?: string | null;
  profilePicture?: string | null;
  isVerified?: boolean;
}

export interface ProfileHeaderProps {
  profile: ProfileHeaderProfile;
  stats: Partial<ProfileStats>;
  onPressFollowers?: () => void;
  onPressFollowing?: () => void;
  /**
   * The action row under the bio: Edit profile on your own, Follow and
   * Message on someone else's. The screen supplies it, so the business fields
   * and type-aware actions that come later (ONE-23) slot in here too.
   */
  actions?: React.ReactNode;
}

/** The avatar's diameter. */
export const PROFILE_AVATAR_SIZE = 88;

/** One stat column: the number over its label, tappable when it leads somewhere. */
const Stat: React.FC<{ value: string; label: string; onPress?: () => void }> = ({ value, label, onPress }) => {
  const body = (
    <>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      {body}
    </View>
  );
};

/**
 * The top of a profile: an 88pt avatar beside Posts / Followers / Following,
 * then the name with its verified mark, the handle, the bio, and an action
 * row. Shared by your own profile and everyone else's.
 */
const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profile,
  stats,
  onPressFollowers,
  onPressFollowing,
  actions,
}) => {
  const bio = getBioText(profile);
  const onPress = { Posts: undefined, Followers: onPressFollowers, Following: onPressFollowing };

  return (
    <View style={styles.header}>
      <View style={styles.top}>
        <Avatar uri={profile.profilePicture} name={profile.name || profile.username} size={PROFILE_AVATAR_SIZE} />
        <View style={styles.stats}>
          {PROFILE_STAT_COLUMNS.map(column => {
            const cell = getStatCell(stats, column);
            return <Stat key={column} value={cell.value} label={cell.label} onPress={onPress[column]} />;
          })}
        </View>
      </View>

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {profile.name || profile.username}
          </Text>
          {profile.isVerified ? (
            <View style={styles.verified} accessible accessibilityLabel="Verified">
              <VerifiedIcon color={color.text} size={16} />
            </View>
          ) : null}
        </View>
        <Text style={styles.handle}>@{profile.username}</Text>
        {bio ? <RenderUserContent content={bio} style={styles.bio} /> : null}
      </View>

      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
};

/** The header's shape while the profile loads. */
export const ProfileHeaderSkeleton: React.FC = () => (
  <View style={styles.header}>
    <View style={styles.top}>
      <Skeleton circle height={PROFILE_AVATAR_SIZE} />
      <View style={styles.stats}>
        {PROFILE_STAT_COLUMNS.map(column => (
          <View key={column} style={styles.stat}>
            <Skeleton width={28} height={16} />
            <Skeleton width={52} height={10} style={styles.skeletonGap} />
          </View>
        ))}
      </View>
    </View>
    <View style={styles.identity}>
      <Skeleton width={140} height={14} />
      <Skeleton width={90} height={12} style={styles.skeletonGap} />
      <Skeleton width="80%" height={12} style={styles.skeletonGap} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: color.bg,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: space.lg,
  },
  stat: {
    alignItems: 'center',
    minWidth: 64,
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  statValue: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  statLabel: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMid,
  },
  identity: {
    marginTop: space.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  verified: {
    marginLeft: space.xs,
  },
  handle: {
    marginTop: 2,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  bio: {
    marginTop: space.sm,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});

export default ProfileHeader;
