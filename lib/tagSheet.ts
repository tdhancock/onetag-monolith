// A printable sheet of tag QR codes (ONE-138), each with its short code
// printed beneath it (ONE-144).
//
// Blank Physical Tags are made to be printed many at a time, stuck around a
// house, and linked one by one as each is first scanned. A sheet is US Letter
// at 300 dpi: twelve codes in three columns and four rows, each centred in a
// square cell with a dashed cut guide round it, inside a half-inch margin no
// printer clips. Each code is drawn from lib/tagQr.ts's layout, mark and all,
// at a whole number of pixels a module, as the single export is.

import { encodeBitmapPng } from './png';
import { drawShortCode, ink, shortCodeTextSize } from './bitmapText';
import { drawQrBitmap, TAG_QR_QUIET_ZONE_MODULES, tagQrLayout } from './tagQr';

/** Print resolution, in dots per inch. */
export const SHEET_DPI = 300;
/** US Letter, 8.5 × 11 in. */
export const SHEET_WIDTH_PX = 2550;
export const SHEET_HEIGHT_PX = 3300;
/** Half an inch all round, inside what any printer can reach. */
export const SHEET_MARGIN_PX = 150;
export const SHEET_COLUMNS = 3;
export const SHEET_ROWS = 4;
export const CODES_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS;
/**
 * Each code's width, quiet zone included: 1.75 in. Modules are whole pixels,
 * so a code comes out as close to this as its module count allows.
 */
export const SHEET_CODE_PX = 525;
/** The cut guide: dashes this long, gaps this long, one pixel wide. */
export const CUT_GUIDE_DASH_PX = 24;
export const CUT_GUIDE_GAP_PX = 16;

/** The square cell each code sits in: the printable area split evenly. */
export const SHEET_CELL_PX = Math.min(
  (SHEET_WIDTH_PX - 2 * SHEET_MARGIN_PX) / SHEET_COLUMNS,
  (SHEET_HEIGHT_PX - 2 * SHEET_MARGIN_PX) / SHEET_ROWS,
);

/** The short code under each code is drawn this many pixels a glyph pixel: about 2.9 mm tall. */
export const SHEET_TEXT_SCALE = 1;

/** Where one code sits on a sheet, in pixels. */
export interface SheetCell {
  shortCode: string;
  /** The cell's top-left corner, where its cut guide runs. */
  cellX: number;
  cellY: number;
  /** The code's top-left corner, quiet zone included, and its size. */
  codeX: number;
  codeY: number;
  codeSize: number;
  pixelsPerModule: number;
  /** The short code beneath it (ONE-144): its top-left corner and size. */
  text: { left: number; top: number; width: number; height: number };
}

/** Split codes into sheets of CODES_PER_SHEET, in order. */
export const sheetsOf = (shortCodes: string[]): string[][] => {
  const sheets: string[][] = [];
  for (let i = 0; i < shortCodes.length; i += CODES_PER_SHEET) sheets.push(shortCodes.slice(i, i + CODES_PER_SHEET));
  return sheets;
};

/** Where each of up to CODES_PER_SHEET codes sits: left to right, top to bottom. */
export const sheetCells = (shortCodes: string[]): SheetCell[] => {
  if (shortCodes.length > CODES_PER_SHEET) throw new Error(`A sheet holds ${CODES_PER_SHEET} codes, not ${shortCodes.length}`);
  return shortCodes.map((shortCode, index) => {
    const layout = tagQrLayout(shortCode);
    const span = layout.modules + 2 * TAG_QR_QUIET_ZONE_MODULES;
    const pixelsPerModule = Math.max(1, Math.round(SHEET_CODE_PX / span));
    const codeSize = span * pixelsPerModule;
    const cellX = SHEET_MARGIN_PX + (index % SHEET_COLUMNS) * SHEET_CELL_PX;
    const cellY = SHEET_MARGIN_PX + Math.floor(index / SHEET_COLUMNS) * SHEET_CELL_PX;
    // The code and the short code under it, as one block, centred in the cell.
    // The code's own quiet zone separates the two.
    const textSize = shortCodeTextSize(shortCode, SHEET_TEXT_SCALE);
    const codeX = cellX + Math.floor((SHEET_CELL_PX - codeSize) / 2);
    const codeY = cellY + Math.floor((SHEET_CELL_PX - codeSize - textSize.height) / 2);
    const text = { left: cellX + Math.floor((SHEET_CELL_PX - textSize.width) / 2), top: codeY + codeSize, ...textSize };
    return { shortCode, cellX, cellY, codeX, codeY, codeSize, pixelsPerModule, text };
  });
};

const isDashed = (offset: number) => offset % (CUT_GUIDE_DASH_PX + CUT_GUIDE_GAP_PX) < CUT_GUIDE_DASH_PX;

/** A sheet as 1-bit rows, packed eight pixels a byte, a set bit white. */
export const drawSheet = (shortCodes: string[]): { rows: Uint8Array[]; cells: SheetCell[] } => {
  const cells = sheetCells(shortCodes);
  const rowBytes = Math.ceil(SHEET_WIDTH_PX / 8);
  const rows = Array.from({ length: SHEET_HEIGHT_PX }, () => new Uint8Array(rowBytes).fill(0xff));

  // The cut guides: every cell edge, across the whole grid, so neighbouring
  // cells share one line to cut along.
  const gridRight = SHEET_MARGIN_PX + SHEET_COLUMNS * SHEET_CELL_PX;
  const gridBottom = SHEET_MARGIN_PX + SHEET_ROWS * SHEET_CELL_PX;
  for (let r = 0; r <= SHEET_ROWS; r += 1) {
    const y = SHEET_MARGIN_PX + r * SHEET_CELL_PX;
    for (let x = SHEET_MARGIN_PX; x <= gridRight; x += 1) if (isDashed(x - SHEET_MARGIN_PX)) ink(rows[y]!, x);
  }
  for (let c = 0; c <= SHEET_COLUMNS; c += 1) {
    const x = SHEET_MARGIN_PX + c * SHEET_CELL_PX;
    for (let y = SHEET_MARGIN_PX; y <= gridBottom; y += 1) if (isDashed(y - SHEET_MARGIN_PX)) ink(rows[y]!, x);
  }

  // Each code, copied a dark pixel at a time from its own bitmap.
  for (const cell of cells) {
    const code = drawQrBitmap(tagQrLayout(cell.shortCode), cell.pixelsPerModule);
    for (let y = 0; y < cell.codeSize; y += 1) {
      const from = code[y]!;
      const to = rows[cell.codeY + y]!;
      for (let x = 0; x < cell.codeSize; x += 1) {
        if ((from[x >> 3]! & (0x80 >> (x & 7))) === 0) ink(to, cell.codeX + x);
      }
    }
    drawShortCode(rows, cell.text.left, cell.text.top, cell.shortCode, SHEET_TEXT_SCALE);
  }

  return { rows, cells };
};

/** One sheet of up to CODES_PER_SHEET codes, as a PNG. */
export const tagSheetPng = (shortCodes: string[]): { png: Uint8Array; cells: SheetCell[] } => {
  const { rows, cells } = drawSheet(shortCodes);
  return { png: encodeBitmapPng(SHEET_WIDTH_PX, SHEET_HEIGHT_PX, rows), cells };
};
