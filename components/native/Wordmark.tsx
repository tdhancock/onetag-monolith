import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { color, type } from '../../theme/tokens';

export interface WordmarkProps {
  /** The type size of "netag", in points. Every other measure scales from it. */
  size?: number;
}

/** The Home header's size. */
export const DEFAULT_WORDMARK_SIZE = 18;

/** What a screen reader says for the mark. */
export const WORDMARK_LABEL = 'OneTag' as const;

/**
 * The mark's proportions, as fractions of the type size. The two rings are
 * cap height across, drawn in a stroke a tenth of that, and overlap by
 * three-tenths of the type size.
 */
const RING_RADIUS = 0.36;
const RING_STROKE = 0.09;
const RING_OVERLAP = 0.3;
const TRACKING = 0.1;

/**
 * The OneTag wordmark: two linked rings for the "O", then "netag" in DM Mono.
 * The front ring is filled with the page colour so it sits over the back one.
 *
 * The one place the mark is drawn. A screen that shows the brand renders this
 * at the size it needs rather than setting "OneTag" in type.
 */
const Wordmark: React.FC<WordmarkProps> = ({ size = DEFAULT_WORDMARK_SIZE }) => {
  const r = size * RING_RADIUS;
  const stroke = size * RING_STROKE;
  const ringR = r - stroke / 2;
  const backX = r;
  const frontX = 3 * r - size * RING_OVERLAP;
  const width = frontX + r;
  const height = 2 * r;
  const tracking = size * TRACKING;

  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={WORDMARK_LABEL}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Circle cx={backX} cy={r} r={ringR} stroke={color.text} strokeWidth={stroke} fill="none" />
        <Circle cx={frontX} cy={r} r={ringR} stroke={color.text} strokeWidth={stroke} fill={color.bg} />
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
