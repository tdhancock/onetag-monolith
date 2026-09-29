//
// target: __tests__/lib/embeddedTags.test.ts
//
// Where an Embedded Tag lands on a post's image (ONE-45, ONE-46). Positions
// are percentages of the picture's content, so the same stored position must
// land on the same point of the picture whatever size it is drawn at, and
// never in the letterbox padding around it.

import {
  clampPct,
  containRect,
  destinationTypeLabel,
  pctForPoint,
  pointForPct,
  tagAccessibilityLabel,
  taggedBadgeLabel,
  tagLabelPosition,
  tagLabelSide,
  TAG_HIT_SIZE,
  TAG_LABEL_GAP,
  TAG_LABEL_HEIGHT,
  TAG_MARKER_SIZE,
} from '../../lib/screens/embeddedTags';
import type { EmbeddedTagDestination } from '../../types';

describe('containRect', () => {
  it('fills a view of the same shape exactly', () => {
    expect(containRect({ width: 400, height: 500 }, { width: 1080, height: 1350 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 500,
    });
  });

  it('letterboxes a wide picture in a tall view: padding above and below', () => {
    // 2:1 picture in a 4:5 view, 400 wide → drawn 400×200, centred vertically.
    expect(containRect({ width: 400, height: 500 }, { width: 2000, height: 1000 })).toEqual({
      x: 0,
      y: 150,
      width: 400,
      height: 200,
    });
  });

  it('pillarboxes a tall picture in a wide view: padding left and right', () => {
    expect(containRect({ width: 400, height: 400 }, { width: 500, height: 1000 })).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 400,
    });
  });

  it('is null until the view and the picture are both measured', () => {
    expect(containRect(null, { width: 10, height: 10 })).toBeNull();
    expect(containRect({ width: 10, height: 10 }, null)).toBeNull();
    expect(containRect({ width: 0, height: 10 }, { width: 10, height: 10 })).toBeNull();
    expect(containRect({ width: 10, height: 10 }, { width: 10, height: 0 })).toBeNull();
  });
});

describe('pointForPct', () => {
  it('lands the same stored position on the same point of the picture on a phone and a tablet', () => {
    const picture = { width: 1600, height: 1200 };
    const phone = containRect({ width: 375, height: 469 }, picture)!;
    const tablet = containRect({ width: 820, height: 1025 }, picture)!;

    const onPhone = pointForPct(phone, 25, 75);
    const onTablet = pointForPct(tablet, 25, 75);

    // Back into picture pixels: the same pixel on both.
    const toPicture = (rect: typeof phone, p: { x: number; y: number }) => ({
      x: ((p.x - rect.x) / rect.width) * picture.width,
      y: ((p.y - rect.y) / rect.height) * picture.height,
    });
    expect(toPicture(phone, onPhone).x).toBeCloseTo(400);
    expect(toPicture(phone, onPhone).y).toBeCloseTo(900);
    expect(toPicture(tablet, onTablet).x).toBeCloseTo(400);
    expect(toPicture(tablet, onTablet).y).toBeCloseTo(900);
  });

  it('never puts a tag in the letterbox padding, even at the picture\'s edges', () => {
    const rect = containRect({ width: 400, height: 500 }, { width: 2000, height: 1000 })!;
    for (const [x, y] of [[0, 0], [100, 100], [0, 100], [100, 0], [50, 50]]) {
      const p = pointForPct(rect, x, y);
      expect(p.y).toBeGreaterThanOrEqual(rect.y);
      expect(p.y).toBeLessThanOrEqual(rect.y + rect.height);
      expect(p.x).toBeGreaterThanOrEqual(rect.x);
      expect(p.x).toBeLessThanOrEqual(rect.x + rect.width);
    }
  });

  it('places the centre at the centre', () => {
    const rect = containRect({ width: 400, height: 500 }, { width: 2000, height: 1000 })!;
    expect(pointForPct(rect, 50, 50)).toEqual({ x: 200, y: 250 });
  });
});

describe('pctForPoint', () => {
  const rect = containRect({ width: 400, height: 500 }, { width: 2000, height: 1000 })!;

  it('is the inverse of pointForPct', () => {
    const p = pointForPct(rect, 33.33, 66.67);
    expect(pctForPoint(rect, p.x, p.y)).toEqual({ xPct: 33.33, yPct: 66.67 });
  });

  it('clamps a tap in the padding to the picture\'s nearest edge', () => {
    expect(pctForPoint(rect, 200, 10)).toEqual({ xPct: 50, yPct: 0 });
    expect(pctForPoint(rect, 500, 490)).toEqual({ xPct: 100, yPct: 100 });
  });

  it('rounds to the column\'s two decimal places', () => {
    const { xPct } = pctForPoint(rect, 123.4567, 250);
    expect(xPct).toBe(30.86);
  });
});

describe('clampPct', () => {
  it('keeps a position within 0–100', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(42)).toBe(42);
    expect(clampPct(Number.NaN)).toBe(0);
  });
});

describe('hit areas', () => {
  it('gives a small marker a touch target of at least 44pt', () => {
    expect(TAG_MARKER_SIZE).toBeLessThan(TAG_HIT_SIZE);
    expect(TAG_HIT_SIZE).toBeGreaterThanOrEqual(44);
  });
});

describe('copy', () => {
  it('counts the tags, and says which way the names switch, never to shop or buy', () => {
    expect(taggedBadgeLabel(3, 'hidden')).toBe('3 TAGGED · SHOW');
    expect(taggedBadgeLabel(3, 'shown')).toBe('3 TAGGED · HIDE');
    expect(taggedBadgeLabel(3)).toBe('3 TAGGED');
    for (const label of [taggedBadgeLabel(3, 'hidden'), taggedBadgeLabel(3, 'shown'), taggedBadgeLabel(3)]) {
      expect(label).not.toMatch(/shop|buy/i);
    }
  });

  it('shows no badge on media without tags', () => {
    expect(taggedBadgeLabel(0)).toBeNull();
    expect(taggedBadgeLabel(0, 'hidden')).toBeNull();
  });

  const lamp: EmbeddedTagDestination = { kind: 'product', productId: 'pd', name: 'Lamp', imageUrl: null };
  const studio: EmbeddedTagDestination = {
    kind: 'profile',
    profileId: 'p',
    username: 'studio',
    profileType: 'business',
    name: 'Studio',
    imageUrl: null,
  };

  it('names each destination kind in the glossary\'s words', () => {
    expect(destinationTypeLabel(lamp)).toBe('Product');
    expect(destinationTypeLabel(studio)).toBe('Business Profile');
    expect(destinationTypeLabel({ ...studio, profileType: 'individual' })).toBe('Individual Profile');
    expect(destinationTypeLabel({ kind: 'project', projectId: 'pj', name: 'Loft', imageUrl: null })).toBe('Project');
  });

  it('announces a tag by its destination\'s name and type', () => {
    expect(tagAccessibilityLabel(lamp)).toBe('Tagged Product: Lamp');
  });
});

describe('name labels', () => {
  // A 2:1 picture letterboxed in a 400×500 view: drawn 400×200 at y = 150.
  const rect = { x: 0, y: 150, width: 400, height: 200 };
  const reach = TAG_MARKER_SIZE / 2 + TAG_LABEL_GAP;

  it('go to the right of a marker, and to the left near the right edge, so they stay on the picture', () => {
    expect(tagLabelSide(rect, 10)).toBe('right');
    expect(tagLabelSide(rect, 55)).toBe('right');
    expect(tagLabelSide(rect, 80)).toBe('left');
  });

  it('sit just past the marker, centred on it', () => {
    expect(tagLabelPosition(rect, 25, 50)).toEqual({ top: 250 - TAG_LABEL_HEIGHT / 2, left: 100 + reach });
    // 320pt across a 400pt view: the label ends just short of the marker.
    expect(tagLabelPosition(rect, 80, 50)).toEqual({ top: 250 - TAG_LABEL_HEIGHT / 2, right: 400 - (320 - reach) });
  });

  it('measure from the right edge of the whole view, letterbox and all', () => {
    // A tall picture pillarboxed in a 400pt view: drawn 200pt wide from x = 100.
    const tall = { x: 100, y: 0, width: 200, height: 400 };
    expect(tagLabelPosition(tall, 100, 0).right).toBe(400 - (300 - reach));
  });
});
