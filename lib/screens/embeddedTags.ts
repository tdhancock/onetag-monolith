// Pure logic for Embedded Tags on a post's image (ONE-45, ONE-46).
//
// A tag's position is stored as a percentage of the image *content* — not of
// the view it sits in — so it lands on the same point of the picture at any
// render size. The view letterboxes the picture (`contentFit="contain"`), so
// both reading a position (rendering) and writing one (the composer) go
// through the same content rect, computed here.

import type { EmbeddedTagDestination } from '../../types';

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * Where an image of `intrinsic` size is drawn inside a `container` when fit
 * with `contain`: scaled to fit whole, centred, with the leftover as padding
 * on two sides. Null until both sizes are known and non-zero — no rect means
 * no tags drawn, never tags placed against a guess.
 */
export const containRect = (container: Size | null, intrinsic: Size | null): Rect | null => {
  if (!container || !intrinsic) return null;
  if (container.width <= 0 || container.height <= 0 || intrinsic.width <= 0 || intrinsic.height <= 0) return null;

  const scale = Math.min(container.width / intrinsic.width, container.height / intrinsic.height);
  const width = intrinsic.width * scale;
  const height = intrinsic.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
};

/** Clamp a percentage to 0–100, so the database's range check never has to. */
export const clampPct = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

/** Round to the column's two decimal places (NUMERIC(5,2)). */
const toColumn = (value: number): number => Math.round(value * 100) / 100;

/** The point, in the container's coordinates, a stored position falls on. */
export const pointForPct = (rect: Rect, xPct: number, yPct: number): { x: number; y: number } => ({
  x: rect.x + (rect.width * clampPct(xPct)) / 100,
  y: rect.y + (rect.height * clampPct(yPct)) / 100,
});

/**
 * The stored position of a point in the container's coordinates — a tap, or
 * the end of a drag. A point in the letterbox padding clamps to the nearest
 * edge of the picture.
 */
export const pctForPoint = (rect: Rect, x: number, y: number): { xPct: number; yPct: number } => ({
  xPct: toColumn(clampPct(((x - rect.x) / rect.width) * 100)),
  yPct: toColumn(clampPct(((y - rect.y) / rect.height) * 100)),
});

// ─── Hit areas ──────────────────────────────────────────────────────────

/** The visible marker's diameter, in points. Small by design. */
export const TAG_MARKER_SIZE = 18;

/** The minimum touch target, in points, on both platforms' guidelines. */
export const TAG_HIT_SIZE = 44;

// ─── Copy ───────────────────────────────────────────────────────────────

/**
 * The badge on media carrying tags. "Tagged" and "tap", never "shop" or
 * "buy": commerce is permanently out of scope.
 */
export const taggedBadgeLabel = (count: number, compact = false): string | null => {
  if (count <= 0) return null;
  return compact ? `${count} TAGGED` : `${count} TAGGED · TAP TO SEE`;
};

/** What kind of Destination a tag leads to, in the glossary's words. */
export const destinationTypeLabel = (destination: EmbeddedTagDestination): string => {
  switch (destination.kind) {
    case 'profile':
      return destination.profileType === 'business' ? 'Business Profile' : 'Individual Profile';
    case 'product':
      return 'Product';
    case 'project':
      return 'Project';
  }
};

/** What a screen reader announces for one tag: its destination's name and type. */
export const tagAccessibilityLabel = (destination: EmbeddedTagDestination): string =>
  `Tagged ${destinationTypeLabel(destination)}: ${destination.name}`;
