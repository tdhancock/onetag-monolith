import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { brandMarkAtTypeSize } from '../../lib/brandMark';
import { color, type } from '../../theme/tokens';

export interface WordmarkProps {
  /** The type size of "netag", in points. Every other measure scales from it. */
  size?: number;
}

/** The Home header's size. */
export const DEFAULT_WORDMARK_SIZE = 18;

/** What a screen reader says for the mark. */
export const WORDMARK_LABEL = 'OneTag' as const;

/** Letter spacing of "netag", as a fraction of the type size. */
const TRACKING = 0.1;

/**
 * The OneTag wordmark: two linked rings for the "O", then "netag" in DM Mono.
 * The front ring is filled with the page colour so it sits over the back one.
 *
 * The one place the wordmark is drawn. A screen that shows the brand renders
 * this at the size it needs rather than setting "OneTag" in type. The rings'
 * proportions are lib/brandMark.ts's, shared with the QR code and the icons.
 */
const Wordmark: React.FC<WordmarkProps> = ({ size = DEFAULT_WORDMARK_SIZE }) => {
  const { width, height, stroke, back, front } = brandMarkAtTypeSize(size);
  const tracking = size * TRACKING;

  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={WORDMARK_LABEL}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Circle cx={back.cx} cy={back.cy} r={back.r} stroke={color.text} strokeWidth={stroke} fill="none" />
        <Circle cx={front.cx} cy={front.cy} r={front.r} stroke={color.text} strokeWidth={stroke} fill={color.bg} />
      </Svg>
      <Text
        style={[
          styles.text,
          { fontSize: size, lineHeight: size, letterSpacing: tracking, marginLeft: tracking / 2 },
        ]}
      >
        netag
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: type.mono,
    color: color.text,
  },
});

export default Wordmark;
