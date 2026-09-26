import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { IconButton } from './ui';
import EmbeddedTags, { useImageContentRect } from './EmbeddedTags';
import { XIcon } from './Icons';
import { color, space, type, withAlpha } from '../../theme/tokens';
import type { EmbeddedTag } from '../../types';

interface ComposeMediaProps {
  uri: string;
  /** The width-to-height ratio the feed will frame the photo at. */
  aspectRatio: number;
  /** Omitted, the photo is read-only (edit post shows it but cannot change it). */
  onRemove?: () => void;
  /** The last publish failed because this photo could not be uploaded. */
  uploadFailed?: boolean;
  /**
   * Tags placed on the photo, previewed exactly as viewers will see them —
   * through the same `EmbeddedTags` overlay, without taps (ONE-46).
   */
  tags?: EmbeddedTag[];
}

/** The note under a photo whose upload failed (ONE-56). */
export const UPLOAD_FAILED_NOTE = "Photo didn't upload. Try again.";

/**
 * A photo attached to a post being written: full content width, framed at the
 * ratio the feed will use, with a remove control over its top-right corner.
 *
 * Self-contained so placing Embedded Tags on the photo (ONE-46) can build on it.
 */
const ComposeMedia: React.FC<ComposeMediaProps> = ({ uri, aspectRatio, onRemove, uploadFailed = false, tags = [] }) => {
  const media = useImageContentRect();
  return (
  <View>
    <View style={[styles.frame, { aspectRatio }]} onLayout={media.onLayout}>
      <Image
        onLoad={media.onLoad}
        source={{ uri }}
        style={styles.image}
        // `contain`, as the feed frames it: an over-wide or over-tall photo is
        // letterboxed here exactly as everyone else will see it (ONE-55).
        contentFit="contain"
        accessibilityLabel="Attached photo"
      />
      <EmbeddedTags tags={tags} contentRect={media.contentRect} interactive={false} />
      {onRemove ? (
        <IconButton
          icon={<XIcon color={color.inverse} size={18} strokeWidth={2} />}
          accessibilityLabel="Remove photo"
          onPress={onRemove}
          style={styles.remove}
        />
      ) : null}
    </View>
    {uploadFailed ? (
      <Text style={styles.failed} accessibilityRole="alert">
        {UPLOAD_FAILED_NOTE}
      </Text>
    ) : null}
  </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: color.bgPanel,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  remove: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    backgroundColor: withAlpha(color.text, 0.55),
  },
  failed: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 13,
    color: color.heart,
  },
});

export default ComposeMedia;
