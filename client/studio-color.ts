import { parseHex } from "../shared/color";

export type HsvColor = { hue: number; saturation: number; brightness: number; opacity: number };
export function hexToHsv(hex: string): HsvColor {
  const [red, green, blue, alpha] = parseHex(hex);
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max === 0 ? 0 : delta / max * 100, brightness: max * 100, opacity: alpha * 100 };
}

export function hsvToHex(color: HsvColor): string {
  const hue = ((color.hue % 360) + 360) % 360;
  const s = Math.min(100, Math.max(0, color.saturation)) / 100;
  const v = Math.min(100, Math.max(0, color.brightness)) / 100;
  const chroma = v * s, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = v - chroma;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const byte = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");
  const rgb = `#${byte(r + m)}${byte(g + m)}${byte(b + m)}`;
  const opacity = Math.min(100, Math.max(0, color.opacity));
  return `${rgb}${opacity < 100 ? byte(opacity / 100) : ""}`.toUpperCase();
}
