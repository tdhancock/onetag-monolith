

import type { Config } from "tailwindcss";
import { color, radius, space, type as typeTokens } from "./theme/tokens";

// Every value below is read from theme/tokens.ts rather than repeated here,
// so a NativeWind class and an inline style cannot drift apart. Keys match
// the token names one-for-one: color.textMuted is `text-textMuted`,
// space.lg is `p-lg`.

const px = (value: number) => `${value}px`;

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/native/**/*.{ts,tsx}",
    "./store/**/*.{ts,tsx}",
    "./theme/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: { ...color },
      borderRadius: Object.fromEntries(
        Object.entries(radius).map(([key, value]) => [key, px(value)]),
      ),
      spacing: Object.fromEntries(
        Object.entries(space).map(([key, value]) => [key, px(value)]),
      ),
      fontFamily: {
        mono: [typeTokens.mono],
        body: [typeTokens.body],
        "body-medium": [typeTokens.bodyMedium],
        "body-bold": [typeTokens.bodyBold],
      },
      fontSize: {
        "mono-label": px(typeTokens.monoLabel.fontSize),
      },
      letterSpacing: {
        "mono-label": px(typeTokens.monoLabel.letterSpacing),
      },
    },
  },
  plugins: [],
} satisfies Config;
