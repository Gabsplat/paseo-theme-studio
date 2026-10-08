import { contrastRatio, parseHex } from "./color";
import type { Palette } from "./theme";

type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = parseHex(hex).map(channel => channel / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    "#" +
    [r, g, b]
      .map(channel =>
        Math.round(Math.min(1, Math.max(0, channel + m)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

export const harmonies = [
  { id: "mono", name: "Monochrome", accent: 0, ring: 0, tint: 1 },
  { id: "analogous", name: "Analogous", accent: 30, ring: -30, tint: 1 },
  { id: "complement", name: "Complementary", accent: 180, ring: 0, tint: 1 },
  { id: "triad", name: "Triad", accent: 120, ring: 240, tint: 1 },
  { id: "neutral", name: "Neutral", accent: 0, ring: 0, tint: 0 },
] as const;
export type HarmonyId = (typeof harmonies)[number]["id"];

/** Moves lightness away from `against` until the pair reaches the contrast target. */
function readable(color: Hsl, against: string, target: number, lighter: boolean): string {
  let next = { ...color };
  for (let step = 0; step < 40 && contrastRatio(hslToHex(next), against) < target; step++)
    next = { ...next, l: Math.min(1, Math.max(0, next.l + (lighter ? 0.02 : -0.02))) };
  return hslToHex(next);
}

/**
 * A full eight-role palette from one seed color. The seed sets the hue; surfaces are
 * tinted neutrals, and text and accent are adjusted until they read on the workspace.
 */
export function harmonyPalette(seed: string, harmony: HarmonyId, appearance: "light" | "dark"): Palette {
  const rule = harmonies.find(item => item.id === harmony)!;
  const base = hexToHsl(seed);
  const dark = appearance === "dark";
  const hue = (offset: number) => (base.h + offset + 360) % 360;
  const tint = Math.min(base.s, 0.5) * rule.tint;
  const surface = (l: number, s = tint * 0.3) => hslToHex({ h: base.h, s, l });
  const background = surface(dark ? 0.075 : 0.965);
  const raised = surface(dark ? 0.11 : 1, dark ? tint * 0.3 : 0);
  const control = surface(dark ? 0.16 : 0.925);
  const workspace = dark ? raised : background;
  const saturation = Math.max(base.s, 0.45);
  return {
    background,
    raised,
    control,
    border: surface(dark ? 0.215 : 0.85, tint * 0.35),
    foreground: readable({ h: base.h, s: tint * 0.25, l: dark ? 0.94 : 0.13 }, workspace, 12, dark),
    mutedForeground: readable({ h: base.h, s: tint * 0.25, l: dark ? 0.66 : 0.4 }, workspace, 4.6, dark),
    // The accent must read against the workspace and carry button text in the background color.
    accent: readable({ h: hue(rule.accent), s: saturation, l: dark ? 0.6 : 0.4 }, background, 4.6, dark),
    ring: hslToHex({ h: hue(rule.ring || rule.accent), s: saturation * 0.8, l: dark ? 0.62 : 0.5 }),
  };
}

/**
 * Makes a palette from an outside source safe to show: text, muted text, and the
 * accent are nudged in lightness until they read, and nothing else is touched.
 */
export function repairPalette(palette: Palette, appearance: "light" | "dark"): Palette {
  const dark = appearance === "dark";
  const workspace = dark ? palette.raised : palette.background;
  const opaque = (hex: string) => hex.slice(0, 7);
  return {
    ...palette,
    foreground: readable(hexToHsl(opaque(palette.foreground)), workspace, 7, dark),
    mutedForeground: readable(hexToHsl(opaque(palette.mutedForeground)), workspace, 4.6, dark),
    accent: readable(hexToHsl(opaque(palette.accent)), palette.background, 4.6, dark),
  };
}
