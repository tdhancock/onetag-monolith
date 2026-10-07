// target: __tests__/lib/brandMark.test.ts
//
// The OneTag mark's geometry (ONE-133). The Wordmark, the QR code's centre
// and the app's icons are all drawn from these numbers, so they are pinned
// here: the proportions the reference designs gave the mark, the box it is
// laid out in, and which points are ink where the rings overlap.

import {
  brandMarkAtTypeSize,
  brandMarkOfWidth,
  isMarkInk,
  MARK_WIDTH_PER_TYPE_SIZE,
  RING_OVERLAP,
  RING_RADIUS,
  RING_STROKE,
} from '../../lib/brandMark';

describe('the proportions', () => {
  it('are the reference designs\' OneTagLogo: radius 0.36, stroke 0.09, overlap 0.3 of the type size', () => {
    expect(RING_RADIUS).toBe(0.36);
    expect(RING_STROKE).toBe(0.09);
    expect(RING_OVERLAP).toBe(0.3);
  });

  it('make the mark 1.14 type sizes wide', () => {
    expect(MARK_WIDTH_PER_TYPE_SIZE).toBeCloseTo(1.14, 10);
  });
});

describe('brandMarkAtTypeSize', () => {
  // The Home header's size, worked by hand from the Wordmark as it stood
  // before the geometry moved here.
  const mark = brandMarkAtTypeSize(18);

  it('lays the mark out in a box two radii tall', () => {
    expect(mark.width).toBeCloseTo(20.52, 10);
    expect(mark.height).toBeCloseTo(12.96, 10);
    expect(mark.outerRadius).toBeCloseTo(6.48, 10);
    expect(mark.stroke).toBeCloseTo(1.62, 10);
  });

  it('centres the stroke half a stroke inside the outer edge', () => {
    expect(mark.back.r).toBeCloseTo(5.67, 10);
    expect(mark.front.r).toBeCloseTo(5.67, 10);
  });

  it('puts the back ring at the left edge and the front ring overlapping it', () => {
    expect(mark.back).toMatchObject({ cx: expect.closeTo(6.48, 10), cy: expect.closeTo(6.48, 10) });
    expect(mark.front).toMatchObject({ cx: expect.closeTo(14.04, 10), cy: expect.closeTo(6.48, 10) });
    // The front ring's right edge is the box's.
    expect(mark.front.cx + mark.outerRadius).toBeCloseTo(mark.width, 10);
  });
});

describe('brandMarkOfWidth', () => {
  it('is exactly as wide as asked, in the same proportions', () => {
    const mark = brandMarkOfWidth(300);
    expect(mark.width).toBeCloseTo(300, 10);
    const reference = brandMarkAtTypeSize(300 / MARK_WIDTH_PER_TYPE_SIZE);
    expect(mark).toEqual(reference);
  });
});

describe('isMarkInk', () => {
  const mark = brandMarkOfWidth(114); // a type size of 100: round numbers
  const { back, front, stroke } = mark;

  it('inks each ring along its stroke', () => {
    expect(isMarkInk(mark, back.cx - back.r, back.cy)).toBe(true);
    expect(isMarkInk(mark, front.cx + front.r, front.cy)).toBe(true);
    expect(isMarkInk(mark, front.cx, front.cy - front.r)).toBe(true);
  });

  it('leaves each ring\'s centre and the space outside them as ground', () => {
    expect(isMarkInk(mark, back.cx, back.cy)).toBe(false);
    expect(isMarkInk(mark, front.cx, front.cy)).toBe(false);
    expect(isMarkInk(mark, 0, 0)).toBe(false);
    expect(isMarkInk(mark, back.cx - back.r - stroke, back.cy)).toBe(false);
  });

  it('hides the back ring where it passes inside the front one', () => {
    // The back ring's rightmost point lies inside the front ring's disc.
    const x = back.cx + back.r;
    expect(Math.hypot(x - front.cx, back.cy - front.cy)).toBeLessThan(mark.outerRadius - stroke);
    expect(isMarkInk(mark, x, back.cy)).toBe(false);
  });

  it('keeps the back ring where it passes outside the front one', () => {
    expect(isMarkInk(mark, back.cx, back.cy - back.r)).toBe(true);
  });
});
