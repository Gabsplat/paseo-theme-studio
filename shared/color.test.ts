import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, parseHex } from "./color";
import { contrastReport } from "./contrast";
import { forestTheme } from "./theme";

test("contrast measures actual displayed text including transparent foreground", () => {
  assert.equal(contrastRatio("#fff", "#000"), 21);
  assert.equal(contrastRatio("#000", "#000"), 1);
  assert.equal(contrastRatio("#ffffff00", "#181A17"), 1);
  assert.ok(contrastRatio("#ffffff80", "#000") > 5);
  assert.ok(contrastRatio("#ffffff80", "#000") < 6);
  const transparent = { ...forestTheme.colors, background: "#00000000", foreground: "#000" };
  assert.equal(contrastReport(transparent, "light").checks[0].ratio, 21);
  assert.equal(contrastReport(transparent, "dark").checks[0].ratio, 1);
});
test("color parsing accepts Paseo formats and rejects unsupported CSS", () => {
  assert.deepEqual(parseHex("#abc"), [170, 187, 204, 1]);
  assert.throws(() => parseHex("red"));
  assert.throws(() => parseHex("#abcd"));
});
