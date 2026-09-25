import React from "react";
import { View, StyleSheet } from "react-native";
import { Skeleton } from "./ui";
import { color, space } from "../../theme/tokens";

/** Header avatar diameter — the same 36pt the post card's header uses. */
export const SKELETON_AVATAR_SIZE = 36;
/** Media placeholder shape: the card's default 4:5 portrait frame. */
export const SKELETON_MEDIA_ASPECT_RATIO = 4 / 5;

/**
 * A post-shaped placeholder: the header row (avatar, name, handle), a
 * full-bleed 4:5 media block, then the likes and caption lines.
 *
 * Kept in the shape of PostCard so the swap from skeleton to content does not
 * jump the layout.
 */
const PostSkeleton: React.FC = () => (
  <View style={styles.post}>
    <View style={styles.header}>
      <Skeleton circle height={SKELETON_AVATAR_SIZE} />
      <View style={styles.headerText}>
        <Skeleton width={120} height={12} />
        <Skeleton width={80} height={10} style={styles.gapXs} />
      </View>
    </View>
    <Skeleton style={{ aspectRatio: SKELETON_MEDIA_ASPECT_RATIO }} />
    <View style={styles.footer}>
      <Skeleton width={96} height={12} />
      <Skeleton width="75%" height={12} style={styles.gapSm} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  post: {
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    // PostCard's own padding above the header.
    paddingTop: space.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: space.lg,
  },
  headerText: {
    marginLeft: space.md,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  gapXs: {
    marginTop: space.xs,
  },
  gapSm: {
    marginTop: space.sm,
  },
});

export default PostSkeleton;
