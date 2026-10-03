// Regenerates shared/community-presets.ts from a checkout of the T3 Themes gallery:
//   git clone https://github.com/SunkenInTime/t3-themes /tmp/t3-themes
//   node scripts/import-t3-themes.mjs /tmp/t3-themes
// Each gallery theme (and its light/dark variant) becomes one eight-color starting pack,
// credited to the author named in its theme file.
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-t3-themes.mjs <t3-themes checkout>");
const projectDirectory = resolve(new URL("..", import.meta.url).pathname);
// Gallery entries that are deliberately unreadable are not useful starting points.
const skipped = new Set(["unusable", "neon-beige"]);

function toHex(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 6 || hex.length === 8) return `#${hex.toUpperCase()}`;
    if (hex.length === 4)
      return `#${[...hex]
        .map(char => char + char)
        .join("")
        .toUpperCase()}`;
    return null;
  }
  const oklch = text.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (!oklch) return null;
  const [lightness, chroma, hue] = oklch.slice(1).map(Number);
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map(channel => {
      const gamma = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, gamma)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase()}`;
}

function luminance(hex) {
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(1 + index, 3 + index), 16) / 255);
  const [r, g, b] = channels.map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Maps T3 Code color roles onto the eight colors Paseo's appearance API accepts. */
function palette(colors) {
  const pick = (...roles) => {
    for (const role of roles) {
      const hex = role in colors ? toHex(colors[role]) : null;
      if (hex) return hex;
    }
    return null;
  };
  const background = pick("canvas");
  const foreground = pick("text");
  const raised = pick("surfaceRaised", "surface");
  const border = pick("border");
  const accent = pick("accent");
  const mutedForeground = pick("textMuted", "mutedForeground");
  if (!background || !foreground || !raised || !border || !accent || !mutedForeground) return null;
  // Paseo paints buttons and links with the accent, so one that matches the background is unusable.
  if (contrast(accent.slice(0, 7), background.slice(0, 7)) < 1.5) return null;
  // A control must keep the text readable; some themes use `secondary` as a text color.
  const control =
    ["toolbarControl", "surfaceOverlay", "secondary", "input"]
      .map(role => pick(role))
      .find(hex => hex && hex.length === 7 && contrast(foreground, hex) >= 4.5) ?? raised;
  return { background, foreground, raised, control, border, accent, mutedForeground, ring: pick("focus") ?? accent };
}

const entries = [];
for (const file of (await readdir(join(source, "themes"))).filter(name => name.endsWith(".json")).sort()) {
  const theme = JSON.parse(await readFile(join(source, "themes", file), "utf8"));
  if (skipped.has(theme.id)) continue;
  const variants = [[theme.appearance, theme.colors]];
  const other = theme.appearance === "dark" ? "light" : "dark";
  // A variant only overrides some roles; the rest fall back to the base colors.
  if (theme.variants?.[other]) variants.push([other, { ...theme.colors, ...theme.variants[other] }]);
  for (const [appearance, colors] of variants) {
    const colorsForPack = palette(colors);
    if (!colorsForPack) {
      console.warn(`Skipped ${theme.id} (${appearance}): missing a required color role or a visible accent.`);
      continue;
    }
    const paired = variants.length > 1;
    entries.push({
      id: `t3-${theme.id}${paired ? `-${appearance}` : ""}`,
      name: `${theme.name}${paired ? (appearance === "dark" ? " Dark" : " Light") : ""}`.slice(0, 60),
      appearance,
      author: theme.author,
      source: `https://t3themes.com/themes/${theme.id}/`,
      colors: colorsForPack,
    });
  }
}

const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const body = `// Generated by scripts/import-t3-themes.mjs from https://github.com/SunkenInTime/t3-themes
// at ${commit}. Do not edit by hand; rerun the script instead.
// Each palette is adapted from a community theme for T3 Code and credited to its author.
import type { Palette } from "./theme";

export type CommunityPreset = {
  id: string;
  name: string;
  appearance: "light" | "dark";
  author: string;
  source: string;
  colors: Palette;
};

export const communityPresets: CommunityPreset[] = ${JSON.stringify(entries, null, 2)};
`;
await writeFile(join(projectDirectory, "shared/community-presets.ts"), body);
console.log(`Wrote ${entries.length} community presets from ${commit.slice(0, 12)}.`);
