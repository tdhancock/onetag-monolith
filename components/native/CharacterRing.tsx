import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { characterCounter, POST_MAX_CHARS } from '../../lib/screens/compose';
import { color, space, type } from '../../theme/tokens';

interface CharacterRingProps {
  length: number;
  max?: number;
}

/** The ring's diameter and stroke, in points. */
const SIZE = 22;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The composer's character counter: a `border` ring that fills with ink as
 * you type. In the last 20 characters, and past the limit, it turns `heart`
 * and shows how many are left (negative once over).
 */
const CharacterRing: React.FC<CharacterRingProps> = ({ length, max = POST_MAX_CHARS }) => {
  const { progress, tone, remaining } = characterCounter(length, max);
  const fill = tone === 'normal' ? color.text : color.heart;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={
        remaining === null ? `${length} of ${max} characters` : `${remaining} characters left`
      }
    >
      {remaining !== null ? (
        <Text style={[styles.remaining, { color: fill }]}>{remaining}</Text>
      ) : null}
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={color.border} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={fill}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          // Start at twelve o'clock rather than three.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  remaining: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
  },
});

export default CharacterRing;
