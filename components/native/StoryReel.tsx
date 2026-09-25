import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar, Pressable, Skeleton } from './ui';
import { PlusIcon } from './Icons';
import { useApp } from '../../store/AppContext.native';
import { gradientFor, latestOneSnap } from '../../lib/oneSnaps';
import { color, radius, space, type } from '../../theme/tokens';
import type { Story } from '../../types';

// OneSnaps render as square-cornered portrait cards, never circles. They are
// still `stories` in code and tables (ONE-19); only what the user reads says
// OneSnap.

export interface StoryGroup {
  username: string;
  avatar: string | null;
  stories: Story[];
}

interface StoryReelProps {
  storyGroups: StoryGroup[];
  allStories: Story[];
  onViewStories: (stories: Story[], startIndex: number) => void;
  /** Rendered first, scrolling with the reel — the "Your OneSnap" tile. */
  leading?: React.ReactElement | null;
}

/** Reel card size, in points: a portrait 3:4 card. */
export const REEL_CARD_WIDTH = 72;
export const REEL_CARD_HEIGHT = 96;
/** Opacity of a card whose OneSnaps have all been seen on this device. */
export const VIEWED_OPACITY = 0.6;
/** The author's avatar on the card's bottom-left corner. */
const CARD_AVATAR_SIZE = 24;

// ─── The card ──────────────────────────────────────

export interface OneSnapCardProps {
  /** The OneSnap the card shows. Absent draws the empty "add" tile. */
  story?: Story;
  /** All seen on this device: dimmed behind a hairline. Otherwise an ink border. */
  viewed?: boolean;
  /**
   * Your own tile. Your OneSnaps are never "new" to you, so it takes the
   * hairline, and it is never dimmed.
   */
  own?: boolean;
  /** The line under the card. */
  label: string;
  /** Draws the author's avatar on the card's bottom-left corner. */
  author?: { avatar: string | null; username: string } | null;
  /** Draws a small `+` badge — your own tile, when you already have a OneSnap. */
  addBadge?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/** The card's face: the OneSnap's image, its gradient if it is text, or the empty add tile. */
const CardFace: React.FC<{ story?: Story; dimmed: boolean }> = ({ story, dimmed }) => {
  if (!story) {
    return (
      <View style={styles.emptyFace}>
        <View style={styles.plusSquare}>
          <PlusIcon color={color.inverse} size={16} strokeWidth={2} />
        </View>
      </View>
    );
  }

  const opacity = dimmed ? VIEWED_OPACITY : 1;

  if (story.imageUrl) {
    return (
      <Image
        source={{ uri: story.imageUrl }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        contentFit="cover"
        transition={200}
      />
    );
  }

  return (
    <LinearGradient colors={[...gradientFor(story)]} style={[styles.textFace, { opacity }]}>
      <Text style={styles.textFaceCopy} numberOfLines={4}>
        {story.content}
      </Text>
    </LinearGradient>
  );
};

export const OneSnapCard: React.FC<OneSnapCardProps> = React.memo(
  ({ story, viewed = false, own = false, label, author, addBadge = false, onPress, accessibilityLabel }) => {
    // An unviewed OneSnap wears the solid ink border; a seen one, and your
    // own tile, a hairline.
    const emphasised = Boolean(story) && !viewed && !own;
    const dimmed = Boolean(story) && viewed && !own;

    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        <View style={[styles.card, emphasised ? styles.unviewed : styles.viewed]}>
          <CardFace story={story} dimmed={dimmed} />
          {author ? (
            <View style={styles.avatarRing}>
              <Avatar uri={author.avatar} name={author.username} size={CARD_AVATAR_SIZE} />
            </View>
          ) : null}
          {addBadge ? (
            <View style={styles.addBadge}>
              <PlusIcon color={color.inverse} size={12} strokeWidth={2.5} />
            </View>
          ) : null}
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  },
);

// ─── The reel ──────────────────────────────────────

const StoryReel: React.FC<StoryReelProps> = ({ storyGroups, allStories, onViewStories, leading }) => {
  const { isStoryViewed } = useApp();

  const handleViewUserStories = (groupStories: Story[]) => {
    if (!groupStories || groupStories.length === 0) return;
    const firstStory = groupStories[0];
    const startIndex = allStories.findIndex(story => story.id === firstStory.id);
    if (startIndex !== -1) {
      onViewStories(allStories, startIndex);
    }
  };

  const areAllStoriesInGroupViewed = (stories: Story[]) => {
    return stories.every(story => isStoryViewed(story.timestamp));
  };

  // Sort: unviewed groups first
  const sortedGroups = [...storyGroups].sort((a, b) => {
    const aViewed = areAllStoriesInGroupViewed(a.stories);
    const bViewed = areAllStoriesInGroupViewed(b.stories);
    if (aViewed === bViewed) return 0;
    return aViewed ? 1 : -1;
  });

  const renderItem = ({ item }: { item: StoryGroup }) => {
    const viewed = areAllStoriesInGroupViewed(item.stories);
    return (
      <OneSnapCard
        story={latestOneSnap(item.stories)}
        viewed={viewed}
        label={item.username}
        author={{ avatar: item.avatar, username: item.username }}
        onPress={() => handleViewUserStories(item.stories)}
        accessibilityLabel={`${item.username}'s OneSnap, ${viewed ? 'seen' : 'new'}`}
      />
    );
  };

  return (
    <FlatList
      data={sortedGroups}
      renderItem={renderItem}
      keyExtractor={item => item.username}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.reel}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={leading ? <View style={styles.leading}>{leading}</View> : null}
    />
  );
};

const Gap = () => <View style={styles.gap} />;

// ─── Loading ───────────────────────────────────────

/** How many placeholder cards the loading strip shows — enough to fill a phone's width. */
export const REEL_SKELETON_COUNT = 5;

/** The reel's shape while it loads: a row of card-sized placeholders with name lines. */
export const StoryReelSkeleton: React.FC = () => (
  <View style={[styles.reel, styles.skeletonRow]}>
    {Array.from({ length: REEL_SKELETON_COUNT }, (_, i) => (
      <View key={i} style={styles.item}>
        <Skeleton width={REEL_CARD_WIDTH} height={REEL_CARD_HEIGHT} />
        <Skeleton width={REEL_CARD_WIDTH * 0.7} height={10} style={styles.skeletonLabel} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  reel: {
    paddingHorizontal: space.lg,
  },
  leading: {
    marginRight: space.sm,
  },
  gap: {
    width: space.sm,
  },
  item: {
    width: REEL_CARD_WIDTH,
  },
  pressed: {
    opacity: 0.7,
  },
  card: {
    width: REEL_CARD_WIDTH,
    height: REEL_CARD_HEIGHT,
    borderRadius: radius.none,
    overflow: 'hidden',
    backgroundColor: color.bgPanel,
  },
  unviewed: {
    borderWidth: 2,
    borderColor: color.text,
  },
  viewed: {
    borderWidth: 1,
    borderColor: color.border,
  },
  emptyFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgPanel,
  },
  plusSquare: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.text,
    borderRadius: radius.none,
  },
  textFace: {
    flex: 1,
    justifyContent: 'center',
    padding: space.sm,
  },
  textFaceCopy: {
    fontFamily: type.bodyBold,
    fontSize: 12,
    lineHeight: 15,
    color: color.inverse,
    textAlign: 'center',
  },
  // A bg-coloured ring lifts the avatar off the image. Round, like the
  // avatar inside it — the one shape exception the house style allows.
  avatarRing: {
    position: 'absolute',
    left: space.xs,
    bottom: space.xs,
    borderWidth: 2,
    borderColor: color.bg,
    borderRadius: (CARD_AVATAR_SIZE + 4) / 2,
  },
  addBadge: {
    position: 'absolute',
    right: space.xs,
    bottom: space.xs,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.text,
    borderWidth: 1,
    borderColor: color.bg,
    borderRadius: radius.none,
  },
  label: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 12,
    color: color.textMid,
    textAlign: 'center',
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  skeletonLabel: {
    marginTop: space.xs,
    alignSelf: 'center',
  },
});

export default React.memo(StoryReel);
