import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { isValidShortCode } from '../../lib/tagLinks';
import { TAG_QR_QUIET_ZONE_MODULES, tagQrLayout, type TagQrLayout } from '../../lib/tagQr';
import { space, type } from '../../theme/tokens';

// A QR code is pure black on pure white whatever the theme. Scanners read
// contrast, and near-black ink or a tinted ground fails on the cheap readers
// a stranger's phone may have. These are deliberately not tokens: a re-skin
// must not "fix" them. The one sanctioned raw colour outside theme/ (ONE-33).
export const QR_INK = '#000000'; // allow-hex: QR scan reliability, see above
export const QR_GROUND = '#ffffff'; // allow-hex: QR scan reliability, see above

/**
 * The dark modules as one SVG path, in module units with the quiet zone
 * included: a rectangle for each horizontal run of dark modules. One path
 * rather than a rect per module, so neighbouring modules can't show a
 * hairline seam between them at fractional scales.
 */
export const qrModulePath = (layout: TagQrLayout): string => {
  const q = TAG_QR_QUIET_ZONE_MODULES;
  const parts: string[] = [];
  layout.dark.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c += 1;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c += 1;
      parts.push(`M${start + q} ${r + q}h${c - start}v1h${start - c}z`);
    }
  });
  return parts.join('');
};

export interface TagQRCodeProps {
  /**
   * The tag's short code. Never a URL: the URL is built in lib/tagQr.ts, so no
   * caller can encode a wrong or stale domain. A code that is not the shape of
   * one the database issues renders nothing.
   */
  shortCode: string;
  /** Width of the code, quiet zone included. */
  size: number;
  /** The short code in DM Mono beneath the code — the fallback when it won't scan. */
  showCode?: boolean;
}

/**
 * A Tag's QR code (ONE-33, ONE-136), drawn from tagQrLayout — the layout the
 * exported image is drawn from too, so the screen shows exactly what prints:
 * buildTagUrl(shortCode) at error correction H, a four-module quiet zone, the
 * OneTag mark in a patch cleared in its centre, black on white on a white
 * card so it scans on any theme, and the short code printed beneath.
 */
const TagQRCode: React.FC<TagQRCodeProps> = ({ shortCode, size, showCode = true }) => {
  const layout = useMemo(() => (isValidShortCode(shortCode) ? tagQrLayout(shortCode) : null), [shortCode]);
  if (!layout) return null;

  const q = TAG_QR_QUIET_ZONE_MODULES;
  const span = layout.modules + 2 * q;
  const { mark } = layout;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR code for tag ${shortCode}`}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
        <Rect x={0} y={0} width={span} height={span} fill={QR_GROUND} />
        <Path d={qrModulePath(layout)} fill={QR_INK} />
        {mark ? (
          <>
            <Circle
              cx={q + mark.left + mark.geometry.back.cx}
              cy={q + mark.top + mark.geometry.back.cy}
              r={mark.geometry.back.r}
              stroke={QR_INK}
              strokeWidth={mark.geometry.stroke}
              fill="none"
            />
            <Circle
              cx={q + mark.left + mark.geometry.front.cx}
              cy={q + mark.top + mark.geometry.front.cy}
              r={mark.geometry.front.r}
              stroke={QR_INK}
              strokeWidth={mark.geometry.stroke}
              fill={QR_GROUND}
            />
          </>
        ) : null}
      </Svg>
      {showCode ? (
        <Text style={[styles.code, { fontSize: Math.max(13, Math.round(size / 14)) }]} selectable>
          {shortCode}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: QR_GROUND,
    paddingBottom: space.md,
  },
  code: {
    fontFamily: type.mono,
    color: QR_INK,
    // Wide tracking keeps look-alike glyphs apart when read off a sticker.
    letterSpacing: 2,
  },
});

export default TagQRCode;
