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

// ─── Name labels ────────────────────────────────────────────────────────

/** The gap between a marker and the name label beside it. */
export const TAG_LABEL_GAP = 4;

/** A name label's height, in points; it is centred on its marker. */
export const TAG_LABEL_HEIGHT = 24;

/**
 * Which side of its marker a tag's name label goes on: the right, unless the
 * tag sits in the right part of the picture, where a label would run off it.
 */
export const tagLabelSide = (rect: Rect, xPct: number): 'left' | 'right' =>
  rect.width > 0 && clampPct(xPct) > 55 ? 'left' : 'right';

/**
 * Where a tag's name label sits in the media view: centred on the marker's
 * height, starting just past its edge on the chosen side. `right` is measured
 * from the view's right edge, which the letterbox leaves as wide as its left.
 */
export const tagLabelPosition = (
  rect: Rect,
  xPct: number,
  yPct: number,
): { top: number; left?: number; right?: number } => {
  const point = pointForPct(rect, xPct, yPct);
  const top = point.y - TAG_LABEL_HEIGHT / 2;
  const reach = TAG_MARKER_SIZE / 2 + TAG_LABEL_GAP;
  if (tagLabelSide(rect, xPct) === 'right') return { top, left: point.x + reach };
  const viewWidth = rect.x * 2 + rect.width;
  return { top, right: viewWidth - (point.x - reach) };
};

// ─── Copy ───────────────────────────────────────────────────────────────

/**
 * The badge on media carrying tags. "Tagged", never "shop" or "buy":
 * commerce is permanently out of scope.
 *
 * On a post it is the switch for the tags' name labels, and says which way it
 * goes: SHOW while they are hidden, HIDE while they show. A grid thumbnail's
 * badge, `labels` left out, is the count alone.
 */
export const taggedBadgeLabel = (count: number, labels?: 'hidden' | 'shown'): string | null => {
  if (count <= 0) return null;
  if (!labels) return `${count} TAGGED`;
  return `${count} TAGGED · ${labels === 'hidden' ? 'SHOW' : 'HIDE'}`;
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
    case 'post':
      return 'Post';
  }
};

/**
 * What a post is called where a tag points at it: its first line, cut short,
 * or who posted it when it has no text.
 */
export const postDestinationName = (content: string | null | undefined, username: string): string => {
  const line = (content ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (!line) return username ? `Post by @${username}` : 'Post';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
};

/** What a screen reader announces for one tag: its destination's name and type. */
export const tagAccessibilityLabel = (destination: EmbeddedTagDestination): string =>
  `Tagged ${destinationTypeLabel(destination)}: ${destination.name}`;
