import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { MonoLabel } from './ui';
import { galleryPositionLabel } from '../../lib/screens/products';
import type { ProductMedia } from '../../features/products';
import { color, space, withAlpha } from '../../theme/tokens';

export interface ProductGalleryProps {
  /** In sort order: the first is the product's representative image. */
  media: ProductMedia[];
  /** The product's name, for each image's label. */
  name: string;
}

/**
 * A product's images, full width and square, swiped through one at a time
 * (ONE-40). The first page is the representative image, as the owner ordered
 * it. A product with no images shows no gallery at all rather than an empty
 * frame.
 */
const ProductGallery: React.FC<ProductGalleryProps> = ({ media, name }) => {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  if (media.length === 0) return null;

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    setIndex(Math.min(media.length - 1, Math.max(0, page)));
  };

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        accessibilityLabel={`Photos of ${name}`}
      >
        {media.map((item, i) => (
          <Image
            key={item.id}
            source={{ uri: item.url }}
            style={{ width, height: width, backgroundColor: color.bgPanel }}
            contentFit="cover"
            transition={200}
            accessibilityLabel={`${name}, photo ${i + 1} of ${media.length}`}
          />
        ))}
      </ScrollView>
      {media.length > 1 ? (
        <View style={styles.position} pointerEvents="none">
          <MonoLabel color="inverse">{galleryPositionLabel(index, media.length)}</MonoLabel>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  position: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    // A scrim over the photo, so the count reads on light and dark images alike.
    backgroundColor: withAlpha(color.text, 0.6),
  },
});

export default ProductGallery;
