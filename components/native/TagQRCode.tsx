import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildTagUrl, isValidShortCode } from '../../lib/tagLinks';
import { space, type } from '../../theme/tokens';

// A QR code is pure black on pure white whatever the theme. Scanners read
// contrast, and near-black ink or a tinted ground fails on the cheap readers
// a stranger's phone may have. These are deliberately not tokens: a re-skin
// must not "fix" them. The one sanctioned raw colour outside theme/ (ONE-33).
export const QR_INK = '#000000'; // allow-hex: QR scan reliability, see above
export const QR_GROUND = '#ffffff'; // allow-hex: QR scan reliability, see above

/**
 * Error correction level H recovers 30% of the code. Physical tags get
 * scuffed, rained on and partly covered, and the payload — a short URL — is
 * small enough that H costs almost nothing in density.
 */
export const TAG_QR_ERROR_CORRECTION = 'H' as const;

/** The quiet zone every reader expects around a code, in modules (ISO/IEC 18004). */
export const TAG_QR_QUIET_ZONE_MODULES = 4;

/** The fewest modules a QR code has on a side: version 1. */
const SMALLEST_QR_MODULES = 21;

/**
 * The quiet zone for a code drawn `size` wide, in the same units.
 *
 * react-native-qrcode-svg takes it in the code's own coordinate space, where
 * one module is `size / modules`. Sized for the largest module any code can
 * have (the 21-module version 1), it is at least four modules at every
 * version — whatever length the tag URL's configured domain makes the payload.
 */
export const tagQrQuietZone = (size: number): number =>
  (size * TAG_QR_QUIET_ZONE_MODULES) / SMALLEST_QR_MODULES;

export interface TagQRCodeProps {
  /**
   * The tag's short code. Never a URL: the URL is built here, so no caller can
   * encode a wrong or stale domain. A code that is not the shape of one the
   * database issues renders nothing.
   */
  shortCode: string;
  /** Width of the code, quiet zone included. */
  size: number;
  /** The short code in DM Mono beneath the code — the fallback when it won't scan. */
  showCode?: boolean;
  /** The underlying Svg, for exporting it as a PNG (`toDataURL`). */
  getRef?: (svg: unknown) => void;
}

/**
 * A Tag's QR code (ONE-33): `buildTagUrl(shortCode)` at error correction H,
 * with a quiet zone of at least four modules, black on white on a white card
 * — so it scans on any theme — and the short code printed beneath.
 */
const TagQRCode: React.FC<TagQRCodeProps> = ({ shortCode, size, showCode = true, getRef }) => {
  if (!isValidShortCode(shortCode)) return null;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR code for tag ${shortCode}`}
    >
      <QRCode
        value={buildTagUrl(shortCode)}
        size={size}
        ecl={TAG_QR_ERROR_CORRECTION}
        quietZone={tagQrQuietZone(size)}
        color={QR_INK}
        backgroundColor={QR_GROUND}
        getRef={getRef}
      />
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
