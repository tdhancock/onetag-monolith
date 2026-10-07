// The OneTag mark: two linked rings (ONE-133).
//
// The one place its proportions live. components/native/Wordmark.tsx draws it
// beside "netag" in the header, lib/tagQr.ts draws it in the centre of every
// tag's QR code, and the app icon, splash and notification images under
// assets/ were drawn from these numbers. Pure arithmetic, no React, so any of
// them can use it.
//
// Every measure is a fraction of the type size the mark sits beside: the two
// rings are cap height across, drawn in a stroke a tenth of that, and overlap
// by three-tenths of the type size. The front ring is filled with the ground,
// so it sits over the back one.

/** Each ring's outer radius, as a fraction of the type size. */
export const RING_RADIUS = 0.36;
/** The ring stroke, as a fraction of the type size. */
export const RING_STROKE = 0.09;
/** How far the two rings overlap, as a fraction of the type size. */
export const RING_OVERLAP = 0.3;

/** The mark's width for a type size of 1: two rings, less their overlap. */
export const MARK_WIDTH_PER_TYPE_SIZE = 4 * RING_RADIUS - RING_OVERLAP;

/** One ring: its centre, and the radius of its stroke's centre line. */
export interface MarkRing {
  cx: number;
  cy: number;
  r: number;
}

/** The mark laid out in a box from (0, 0) to (width, height). */
export interface BrandMark {
  width: number;
  height: number;
  /** Stroke width of both rings. */
  stroke: number;
  /** Each ring's outer radius: its centre line plus half the stroke. */
  outerRadius: number;
  /** The left ring, drawn first. */
  back: MarkRing;
  /** The right ring, filled with the ground, drawn over the back one. */
  front: MarkRing;
}

/** The mark drawn beside type of this size, as the Wordmark draws it. */
export const brandMarkAtTypeSize = (size: number): BrandMark => {
  const outerRadius = size * RING_RADIUS;
  const stroke = size * RING_STROKE;
  const r = outerRadius - stroke / 2;
  return {
    width: size * MARK_WIDTH_PER_TYPE_SIZE,
    height: 2 * outerRadius,
    stroke,
    outerRadius,
    back: { cx: outerRadius, cy: outerRadius, r },
    front: { cx: 3 * outerRadius - size * RING_OVERLAP, cy: outerRadius, r },
  };
};

/** The mark drawn exactly `width` wide, for an icon or a QR code's centre. */
export const brandMarkOfWidth = (width: number): BrandMark =>
  brandMarkAtTypeSize(width / MARK_WIDTH_PER_TYPE_SIZE);

/**
 * Whether the point (x, y), in the mark's own box, is ink.
 *
 * The front ring is filled with the ground, so inside its outer edge only its
 * own stroke is ink; outside it, the back ring's stroke is. This is how a
 * one-colour renderer — a 1-bit image, or a tinted notification icon — draws
 * the overlap without painting a fill.
 */
export const isMarkInk = (mark: BrandMark, x: number, y: number): boolean => {
  const half = mark.stroke / 2;
  const fromFront = Math.hypot(x - mark.front.cx, y - mark.front.cy);
  if (fromFront <= mark.outerRadius) return Math.abs(fromFront - mark.front.r) <= half;
  const fromBack = Math.hypot(x - mark.back.cx, y - mark.back.cy);
  return Math.abs(fromBack - mark.back.r) <= half;
};
