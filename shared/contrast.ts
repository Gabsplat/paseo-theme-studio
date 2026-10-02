import { type Palette } from "./theme";

function rgba(hex: string): [number, number, number, number] {
  const value = hex.slice(1);
  const full = value.length === 3 ? [...value].map(char => char + char).join("") : value;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255, full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
}
function over(front: ReturnType<typeof rgba>, back: ReturnType<typeof rgba>): ReturnType<typeof rgba> {
  return [front[0] * front[3] + back[0] * (1 - front[3]), front[1] * front[3] + back[1] * (1 - front[3]), front[2] * front[3] + back[2] * (1 - front[3]), 1];
}
function luminance(color: ReturnType<typeof rgba>): number {
  const channel = color.slice(0, 3).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channel[0] * 0.2126 + channel[1] * 0.7152 + channel[2] * 0.0722;
}
export function contrastReport(colors: Palette, appearance: "dark" | "light") {
  const canvas: ReturnType<typeof rgba> = appearance === "light" ? [1, 1, 1, 1] : [0, 0, 0, 1];
  const background = over(rgba(colors.background), canvas);
  const pairs = [["foreground", "background"], ["mutedForeground", "background"], ["mutedForeground", "raised"], ["foreground", "raised"], ["foreground", "control"], ["accent", "background"], ["background", "accent"], ["ring", "control"]] as const;
  return { alphaCompositing: `Transparent colors are composited over ${appearance === "light" ? "white" : "black"} canvas.`, checks: pairs.map(([frontKey, backKey]) => {
    const back = backKey === "background" ? background : over(rgba(colors[backKey]), background);
    const front = over(rgba(colors[frontKey]), back);
    const a = luminance(front), b = luminance(back);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { foreground: frontKey, background: backKey, ratio: Number(ratio.toFixed(2)), aaNormalText: ratio >= 4.5, aaLargeText: ratio >= 3, aaNonText: ratio >= 3 };
  }) };
}
