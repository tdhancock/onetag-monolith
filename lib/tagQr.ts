// How a Tag's QR code is laid out and drawn, on screen and in the exported
// image (ONE-33, ONE-136).
//
// tagQrLayout below is the one description of a tag's code: its modules, the
// patch cleared in its centre, and the OneTag mark drawn in that patch.
// components/native/TagQRCode.tsx draws it on screen and tagQrPng draws it
// into the image that is saved or shared for printing, so what is printed is
// exactly what the screen showed.

import QRCode from 'qrcode';
import { buildTagUrl, isValidShortCode } from './tagLinks';
import { encodeBitmapPng } from './png';
import { brandMarkOfWidth, isMarkInk, type BrandMark } from './brandMark';
import { drawShortCode, shortCodeTextSize } from './bitmapText';

/**
 * Error correction level H recovers 30% of the code. Physical tags get
 * scuffed, rained on and partly covered, the mark in the centre takes some of
 * that budget on purpose, and the payload — a short URL — is small enough that
 * H costs almost nothing in density.
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

/**
 * The patch cleared for the mark aims at this fraction of the code's width.
 * A third of the width is a ninth of its area: well inside what level H
 * recovers, with room left for the scuffs it is there for.
 */
export const TAG_QR_PATCH_FRACTION = 1 / 3;

/**
 * Below this many modules a side the mark would be too small to read, so a
 * code that can't clear at least this much carries none.
 */
export const TAG_QR_MIN_PATCH_MODULES = 7;

/** A square of whole modules, `size` on a side, from (`start`, `start`). */
export interface TagQrPatch {
  start: number;
  size: number;
}

/** The mark, in module units, with its box's top-left corner in the code. */
export interface TagQrMark {
  left: number;
  top: number;
  geometry: BrandMark;
}

/** A tag's code as both renderers draw it. Units are modules, quiet zone excluded. */
export interface TagQrLayout {
  /** What the code encodes: buildTagUrl(shortCode). */
  payload: string;
  /** Modules on a side. */
  modules: number;
  /** `dark[row][col]`, with the centre patch already cleared. */
  dark: boolean[][];
  /**
   * The centre patch cleared for the mark, or null when every patch big
   * enough would cover a function pattern. From version 7 an alignment
   * pattern sits in the centre, so a code with a long payload carries no mark
   * rather than one that may not scan.
   */
  patch: TagQrPatch | null;
  /** The mark in the patch, or null with it. */
  mark: TagQrMark | null;
}

/** The odd module count closest to TAG_QR_PATCH_FRACTION of the code's width. */
const targetPatchSize = (modules: number): number =>
  Math.round((modules * TAG_QR_PATCH_FRACTION - 1) / 2) * 2 + 1;

/** The largest centred patch, no bigger than the target, that covers no function pattern. */
const centrePatch = (modules: number, isReserved: (row: number, col: number) => boolean): TagQrPatch | null => {
  for (let size = targetPatchSize(modules); size >= TAG_QR_MIN_PATCH_MODULES; size -= 2) {
    const start = (modules - size) / 2;
    let clear = true;
    for (let row = start; clear && row < start + size; row += 1) {
      for (let col = start; col < start + size; col += 1) {
        if (isReserved(row, col)) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return { start, size };
  }
  return null;
};

/**
 * The layout for any payload. tagQrLayout is the one callers use; this is
 * exported so tests can try payloads no configured domain produces today.
 */
export const qrLayoutForPayload = (payload: string): TagQrLayout => {
  const { modules: matrix } = QRCode.create(payload, { errorCorrectionLevel: TAG_QR_ERROR_CORRECTION });
  const modules = matrix.size;
  const patch = centrePatch(modules, (row, col) => Boolean(matrix.isReserved(row, col)));

  const inPatch = (row: number, col: number) =>
    patch !== null &&
    row >= patch.start &&
    row < patch.start + patch.size &&
    col >= patch.start &&
    col < patch.start + patch.size;

  const dark = Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => !inPatch(row, col) && Boolean(matrix.get(row, col))),
  );

  let mark: TagQrMark | null = null;
  if (patch) {
    // One module of white all round the mark, inside the patch.
    const geometry = brandMarkOfWidth(patch.size - 2);
    mark = { left: patch.start + 1, top: patch.start + (patch.size - geometry.height) / 2, geometry };
  }

  return { payload, modules, dark, patch, mark };
};

/** A tag's code: buildTagUrl(shortCode), its centre cleared, the mark drawn there. */
export const tagQrLayout = (shortCode: string): TagQrLayout => {
  if (!isValidShortCode(shortCode)) throw new Error(`Not a tag short code: ${shortCode}`);
  return qrLayoutForPayload(buildTagUrl(shortCode));
};

/**
 * Whether the point (x, y), in modules from the code's top-left corner (quiet
 * zone excluded), is ink: the module it falls in, or the mark inside the patch.
 */
export const isQrInk = (layout: TagQrLayout, x: number, y: number): boolean => {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (row < 0 || col < 0 || row >= layout.modules || col >= layout.modules) return false;
  const { patch, mark } = layout;
  if (patch && mark && row >= patch.start && row < patch.start + patch.size && col >= patch.start && col < patch.start + patch.size) {
    return isMarkInk(mark.geometry, x - mark.left, y - mark.top);
  }
  return layout.dark[row]![col]!;
};

/**
 * The short code under an exported code is drawn this many pixels a glyph
 * pixel: about 5.8 mm tall at 300 dpi, legible on a code printed 10 cm wide.
 */
export const TAG_QR_EXPORT_TEXT_SCALE = 2;

export interface TagQrPng {
  /** The PNG file's bytes. */
  png: Uint8Array;
  /** The code's square, quiet zone included: the image's width, and the height of its top part. */
  size: number;
  /** The whole image's height: the code's square, then the short code beneath it (ONE-144). */
  height: number;
  /** Where the short code is drawn, below the quiet zone. */
  text: { left: number; top: number; width: number; height: number };
  /** Modules on a side of the code itself, without the quiet zone. */
  modules: number;
  /** Pixels on a side of each module. */
  pixelsPerModule: number;
  /** What was drawn. */
  layout: TagQrLayout;
}

/**
 * A layout as a 1-bit image: every module the same whole number of pixels,
 * `pixelsPerModule` on a side, and the quiet zone around it. Rows are packed
 * eight pixels a byte, a set bit white, as lib/png.ts takes them.
 */
export const drawQrBitmap = (layout: TagQrLayout, pixelsPerModule: number): Uint8Array[] => {
  const span = layout.modules + TAG_QR_QUIET_ZONE_MODULES * 2;
  const size = span * pixelsPerModule;
  const rowBytes = Math.ceil(size / 8);
  const { patch } = layout;

  // All white, then each dark module's bits cleared. One module row is the
  // same for all its pixel rows, so it is built once and shared by them —
  // except across the patch, where the mark's curves differ row to row.
  const quiet = new Uint8Array(rowBytes).fill(0xff);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < span; y += 1) {
    const moduleRow = y - TAG_QR_QUIET_ZONE_MODULES;
    let row = quiet;
    if (moduleRow >= 0 && moduleRow < layout.modules) {
      row = new Uint8Array(rowBytes).fill(0xff);
      for (let col = 0; col < layout.modules; col += 1) {
        if (!layout.dark[moduleRow]![col]) continue;
        const left = (col + TAG_QR_QUIET_ZONE_MODULES) * pixelsPerModule;
        for (let x = left; x < left + pixelsPerModule; x += 1) row[x >> 3] &= ~(0x80 >> (x & 7));
      }
    }
    const crossesPatch = patch !== null && moduleRow >= patch.start && moduleRow < patch.start + patch.size;
    for (let i = 0; i < pixelsPerModule; i += 1) {
      if (!crossesPatch) {
        rows.push(row);
        continue;
      }
      // The mark, sampled at each pixel's centre.
      const own = row.slice();
      const my = moduleRow + (i + 0.5) / pixelsPerModule;
      const fromX = (patch!.start + TAG_QR_QUIET_ZONE_MODULES) * pixelsPerModule;
      for (let x = fromX; x < fromX + patch!.size * pixelsPerModule; x += 1) {
        const mx = (x + 0.5) / pixelsPerModule - TAG_QR_QUIET_ZONE_MODULES;
        if (isQrInk(layout, mx, my)) own[x >> 3] &= ~(0x80 >> (x & 7));
      }
      rows.push(own);
    }
  }
  return rows;
};

/**
 * A Tag's QR code as a PNG for printing: black on white, every module the
 * same whole number of pixels, a quiet zone of TAG_QR_QUIET_ZONE_MODULES all
 * round, the mark in its centre, and at least TAG_QR_EXPORT_PX across.
 * Whole pixels keep every edge sharp; a fractional module size would blur
 * each one.
 *
 * Beneath the quiet zone, the short code, centred (ONE-144): what someone
 * types in when the sticker is too scuffed to scan, as the screen shows it.
 * A quiet zone's depth of white follows it, so it isn't cut tight.
 */
export const tagQrPng = (shortCode: string): TagQrPng => {
  const layout = tagQrLayout(shortCode);
  const span = layout.modules + TAG_QR_QUIET_ZONE_MODULES * 2;
  const pixelsPerModule = Math.ceil(TAG_QR_EXPORT_PX / span);
  const size = span * pixelsPerModule;

  const textSize = shortCodeTextSize(shortCode, TAG_QR_EXPORT_TEXT_SCALE);
  const text = { left: Math.floor((size - textSize.width) / 2), top: size, ...textSize };
  const height = size + text.height + TAG_QR_QUIET_ZONE_MODULES * pixelsPerModule;
  const rowBytes = Math.ceil(size / 8);
  // Fresh rows for the text: the code's own rows may be shared between pixel rows.
  const below = Array.from({ length: height - size }, () => new Uint8Array(rowBytes).fill(0xff));
  const rows = [...drawQrBitmap(layout, pixelsPerModule), ...below];
  drawShortCode(rows, text.left, text.top, shortCode, TAG_QR_EXPORT_TEXT_SCALE);

  const png = encodeBitmapPng(size, height, rows);
  return { png, size, height, text, modules: layout.modules, pixelsPerModule, layout };
};
