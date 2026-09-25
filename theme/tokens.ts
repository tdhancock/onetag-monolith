// OneTag design tokens — the single source of truth for colour, radius,
// space and type.
//
// `tailwind.config.ts` imports this module directly, so a NativeWind class
// and an inline style resolve to the same value by construction rather than
// by convention. There is no second copy to keep in sync.
//
// Raw hex belongs in this file and nowhere else; scripts/check-no-raw-hex.sh
// excludes it by name and gates every other token-layer directory.

// Light editorial: white ground, near-black ink, hairline rules.
export const color = {
  bg: '#ffffff',
  bgSub: '#fafafa',
  bgPanel: '#f5f5f5',
  border: '#e8e8e8',
  borderStrong: '#d0d0d0',
  text: '#0a0a0a',
  textMid: '#555555',
  textMuted: '#999999',
  inverse: '#ffffff',
  heart: '#e53935',
  affiliate: '#4caf50',
} as const;

// Square corners are the house style, so every step is deliberately 0. The
// scale exists so a component has something to reference instead of
// inventing a radius of its own — and so a future change lands in one place.
export const radius = {
  none: 0,
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  full: 0,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const type = {
  mono: 'DMMono_500Medium',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',

  // The recurring micro-label treatment: monospace, 10px, wide tracking,
  // small caps. Defined once here so screens reference it rather than
  // re-deriving the tracking every time. React Native takes letterSpacing
  // in points, so 0.18em at 10px is 1.8.
  monoLabel: {
    fontFamily: 'DMMono_500Medium',
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
} as const;

// Backgrounds for text OneSnaps. These are content rather than chrome — a
// text OneSnap is drawn on one — which is why they sit apart from `color` and
// are allowed to be colourful. Each pair runs top to bottom.
export const oneSnapGradients = [
  ['#1e3a5f', '#0f172a'],
  ['#4a1942', '#1a0a2e'],
  ['#1a3c34', '#0a1628'],
  ['#3d1f00', '#1a0e00'],
  ['#2d1b4e', '#0e0a1a'],
  ['#5b2c6f', '#1a1a2e'],
  ['#0e4d44', '#041c2c'],
] as const;

export type OneSnapGradient = (typeof oneSnapGradients)[number];

/**
 * A six-digit token colour at partial opacity, as an rgba() string — for the
 * scrims and translucent controls laid over full-bleed media, where a solid
 * token would hide the content underneath.
 */
export const withAlpha = (hex: string, alpha: number): string => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`withAlpha expects a six-digit hex colour, got ${hex}`);
  const [r, g, b] = match.slice(1).map((pair) => parseInt(pair, 16));
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export const tokens = { color, radius, space, type } as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof color;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
