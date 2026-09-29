// How a Tag's QR code is encoded, on screen and in the exported image (ONE-33).
//
// components/native/TagQRCode.tsx draws the code on screen, and tagQrPng
// below draws the image that is saved or shared for printing. Both encode
// buildTagUrl(shortCode) with the settings here, so what is printed is what
// the screen showed.

import QRCode from 'qrcode';
import { buildTagUrl, isValidShortCode } from './tagLinks';
import { encodeBitmapPng } from './png';

/**
 * Error correction level H recovers 30% of the code. Physical tags get
 * scuffed, rained on and partly covered, and the payload — a short URL — is
 * small enough that H costs almost nothing in density.
 */
export const TAG_QR_ERROR_CORRECTION = 'H' as const;

/** The quiet zone every reader expects around a code, in modules (ISO/IEC 18004). */
export const TAG_QR_QUIET_ZONE_MODULES = 4;

/**
 * The exported image is at least this many pixels wide and tall. A code
 * captured at its size on screen prints blurry; 1200px prints sharp at
 * 10 cm across.
 */
export const TAG_QR_EXPORT_PX = 1200;

export interface TagQrPng {
  /** The PNG file's bytes. */
  png: Uint8Array;
  /** Width and height in pixels, quiet zone included. */
  size: number;
  /** Modules on a side of the code itself, without the quiet zone. */
  modules: number;
  /** Pixels on a side of each module. */
  pixelsPerModule: number;
}

/**
 * A Tag's QR code as a PNG for printing: black on white, every module the
 * same whole number of pixels, a quiet zone of TAG_QR_QUIET_ZONE_MODULES all
 * round, and at least TAG_QR_EXPORT_PX on a side. Whole pixels keep every
 * edge sharp; a fractional module size would blur each one.
 */
export const tagQrPng = (shortCode: string): TagQrPng => {
  if (!isValidShortCode(shortCode)) throw new Error(`Not a tag short code: ${shortCode}`);

  const { modules: matrix } = QRCode.create(buildTagUrl(shortCode), {
    errorCorrectionLevel: TAG_QR_ERROR_CORRECTION,
  });
  const modules = matrix.size;
  const span = modules + TAG_QR_QUIET_ZONE_MODULES * 2;
  const pixelsPerModule = Math.ceil(TAG_QR_EXPORT_PX / span);
  const size = span * pixelsPerModule;
  const rowBytes = Math.ceil(size / 8);

  // All white, then each dark module's bits cleared. One module row is the
  // same for all its pixel rows, so it is built once and shared by them.
  const quiet = new Uint8Array(rowBytes).fill(0xff);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < span; y += 1) {
    const moduleRow = y - TAG_QR_QUIET_ZONE_MODULES;
    let row = quiet;
    if (moduleRow >= 0 && moduleRow < modules) {
      row = new Uint8Array(rowBytes).fill(0xff);
      for (let col = 0; col < modules; col += 1) {
        if (!matrix.get(moduleRow, col)) continue;
        const left = (col + TAG_QR_QUIET_ZONE_MODULES) * pixelsPerModule;
        for (let x = left; x < left + pixelsPerModule; x += 1) row[x >> 3] &= ~(0x80 >> (x & 7));
      }
    }
    for (let i = 0; i < pixelsPerModule; i += 1) rows.push(row);
  }

  return { png: encodeBitmapPng(size, size, rows), size, modules, pixelsPerModule };
};
