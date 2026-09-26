import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Pressable, Skeleton } from './ui';
import {
  firstLine,
  profileGridTileSize,
  PROFILE_GRID_COLUMNS,
  PROFILE_GRID_GAP,
} from '../../lib/screens/profile';
import { color, space, type } from '../../theme/tokens';
import type { Post } from '../../types';
import type { ProductSummary } from '../../features/products';

interface GridTileProps {
  post: Post;
  /** The tile's position, so the last column drops its trailing gap. */
  index: number;
  onPress: () => void;
}

/** A tile's margins: a 1pt gap to its right, except in the last column, and below. */
const tileSpacing = (index: number) => ({
  marginRight: index % PROFILE_GRID_COLUMNS === PROFILE_GRID_COLUMNS - 1 ? 0 : PROFILE_GRID_GAP,
  marginBottom: PROFILE_GRID_GAP,
});

/**
 * One square in a profile's three-column grid: the photo cropped to cover, or
 * a text post's first line on `bgPanel`.
 */
export const GridTile: React.FC<GridTileProps> = React.memo(({ post, index, onPress }) => {
  const { width } = useWindowDimensions();
  const size = profileGridTileSize(width);
  const isTextPost = post.media_type === 'text' || !post.media;
  const line = firstLine(post.content);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isTextPost ? line || 'Post' : 'Photo post'}
      style={({ pressed }) => [{ width: size, height: size }, tileSpacing(index), pressed && styles.pressed]}
    >
      {isTextPost ? (
        <View style={styles.textTile}>
          <Text style={styles.textTileCopy} numberOfLines={4}>
            {line}
          </Text>
        </View>
      ) : (
        <Image
          // The full photo, with the 50px preview only as its blur-up. The
          // tile used to draw the preview itself, stretched ~8x: the photos
          // looked zoomed in and soft.
          source={{ uri: post.media }}
          placeholder={post.media_preview_url ? { uri: post.media_preview_url } : undefined}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
      )}
    </Pressable>
  );
});

interface ProductTileProps {
  product: ProductSummary;
  /** The tile's position, so the last column drops its trailing gap. */
  index: number;
  onPress: () => void;
}

/**
 * One square in a business's Products grid (ONE-43): its representative image
 * cropped to cover, or its name on `bgPanel` when it has none — as a text
 * post's tile does.
 */
export const ProductTile: React.FC<ProductTileProps> = React.memo(({ product, index, onPress }) => {
  const { width } = useWindowDimensions();
  const size = profileGridTileSize(width);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      style={({ pressed }) => [{ width: size, height: size }, tileSpacing(index), pressed && styles.pressed]}
    >
      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.image} contentFit="cover" transition={200} />
      ) : (
        <View style={styles.textTile}>
          <Text style={styles.textTileCopy} numberOfLines={4}>
            {product.name}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

/** How many placeholder tiles the loading grid draws: two rows. */
const SKELETON_TILES = PROFILE_GRID_COLUMNS * 2;

/** The grid's shape while it loads. */
export const ProfileGridSkeleton: React.FC = () => {
  const { width } = useWindowDimensions();
  const size = profileGridTileSize(width);
  return (
    <View style={styles.skeletonGrid}>
      {Array.from({ length: SKELETON_TILES }, (_, i) => (
        <View key={i} style={tileSpacing(i)}>
          <Skeleton width={size} height={size} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: color.bgPanel,
  },
  textTile: {
    flex: 1,
    justifyContent: 'center',
    padding: space.sm,
    backgroundColor: color.bgPanel,
  },
  textTileCopy: {
    fontFamily: type.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: color.text,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
