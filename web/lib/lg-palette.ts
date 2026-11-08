import type { CSSProperties } from "react";
import { COLOR_HEX, type TutorColor } from "./lg-types";

// Each tutor colour is a small family of colours, so orbs and tints feel many-coloured
// while still clearly belonging to one tutor.
export type TutorPalette = {
  name: string;
  // The orb's three colours. They drift into neighbouring hues on purpose.
  c1: string;
  c2: string;
  c3: string;
  // Selected states and focus rings. Dark enough for white text on top.
  accent: string;
  // The tutor's marks on the board, readable on white paper.
  mark: string;
};

export const TUTOR_PALETTES: Record<TutorColor, TutorPalette> = {
  blue: {
    name: "Lagoon",
    c1: "oklch(0.68 0.19 262)",
    c2: "oklch(0.8 0.13 210)",
    c3: "oklch(0.67 0.2 300)",
    accent: "oklch(0.52 0.2 262)",
    mark: COLOR_HEX.blue,
  },
  red: {
    name: "Ember",
    c1: "oklch(0.67 0.21 25)",
    c2: "oklch(0.74 0.17 355)",
    c3: "oklch(0.8 0.15 60)",
    accent: "oklch(0.54 0.2 27)",
    mark: COLOR_HEX.red,
  },
  green: {
    name: "Grove",
    c1: "oklch(0.72 0.16 160)",
    c2: "oklch(0.82 0.12 195)",
    c3: "oklch(0.87 0.17 122)",
    accent: "oklch(0.5 0.12 165)",
    mark: COLOR_HEX.green,
  },
  orange: {
    name: "Sunset",
    c1: "oklch(0.74 0.18 52)",
    c2: "oklch(0.86 0.15 88)",
    c3: "oklch(0.7 0.19 12)",
    accent: "oklch(0.56 0.17 45)",
    mark: COLOR_HEX.orange,
  },
  violet: {
    name: "Nebula",
    c1: "oklch(0.64 0.22 305)",
    c2: "oklch(0.73 0.19 345)",
    c3: "oklch(0.63 0.19 268)",
    accent: "oklch(0.5 0.21 305)",
    mark: COLOR_HEX.violet,
  },
};

export type LinearRgb = [number, number, number];

// "oklch(L C H)" to linear sRGB, clamped to the screen's range. The orb's shader mixes in linear light.
export function oklchToLinearRgb(value: string): LinearRgb {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!match) return [0.5, 0.5, 0.5];
  const [lightness, chroma, hueDegrees] = match.slice(1).map(Number);
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (channel: number) => Math.min(Math.max(channel, 0), 1);
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function paletteRgb(color: TutorColor): [LinearRgb, LinearRgb, LinearRgb] {
  const palette = TUTOR_PALETTES[color];
  return [oklchToLinearRgb(palette.c1), oklchToLinearRgb(palette.c2), oklchToLinearRgb(palette.c3)];
}

// The CSS variables an element needs to take on a tutor's colours. Pair with the
// tutor-theme utility so a change of tutor fades smoothly instead of snapping.
export function paletteVars(color: TutorColor): CSSProperties {
  const palette = TUTOR_PALETTES[color];
  return {
    "--tutor-c1": palette.c1,
    "--tutor-c2": palette.c2,
    "--tutor-c3": palette.c3,
    "--tutor-accent": palette.accent,
    "--tutor-mark": palette.mark,
  } as CSSProperties;
}
