import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio } from "./color";
import { harmonies, harmonyPalette, hexToHsl, hslToHex } from "./harmony";
import { paletteSchema } from "./theme";

test("hex and HSL convert both ways", () => {
  for (const hex of ["#000000", "#FFFFFF", "#E11D2E", "#0AFF64", "#3B8BFF", "#808080"])
    assert.equal(hslToHex(hexToHsl(hex)), hex);
});

test("every harmony yields a valid palette with readable text and accent buttons", () => {
  for (const seed of ["#E11D2E", "#0AFF64", "#3B8BFF", "#F5D90A", "#111111", "#FFFFFF", "#7C3AED"])
    for (const appearance of ["dark", "light"] as const)
      for (const harmony of harmonies) {
        const palette = paletteSchema.parse(harmonyPalette(seed, harmony.id, appearance));
        const workspace = appearance === "dark" ? palette.raised : palette.background;
        const label = `${seed} ${harmony.id} ${appearance}`;
        assert.ok(contrastRatio(palette.foreground, workspace) >= 7, `text ${label}`);
        assert.ok(contrastRatio(palette.mutedForeground, workspace) >= 4.5, `muted ${label}`);
        assert.ok(contrastRatio(palette.background, palette.accent) >= 4.5, `accent button ${label}`);
      }
});
