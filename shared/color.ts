import { hexSchema } from "./theme";

export function parseHex(value: string): [number, number, number, number] {
  const hex = hexSchema.parse(value).slice(1);
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map(v => v + v)
          .join("")
      : hex;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
    expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  ];
}

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map(channel => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Alpha colors are composited; a transparent backdrop defaults to the dark canvas. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground),
    bg = parseHex(background);
  const opaqueBg = bg.slice(0, 3).map(v => v * bg[3]);
  const opaqueFg = fg.slice(0, 3).map((v, i) => v * fg[3] + opaqueBg[i] * (1 - fg[3]));
  const a = luminance(opaqueFg),
    b = luminance(opaqueBg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
