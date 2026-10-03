import { test } from "node:test";
import assert from "node:assert/strict";
import { readActiveTheme } from "./rpc";
import { forestTheme } from "./theme";

test("active theme rpc returns only the nullable active pack and takes no input", () => {
  assert.equal(readActiveTheme.output.parse(null), null);
  assert.deepEqual(readActiveTheme.output.parse(forestTheme), forestTheme);
  assert.throws(() => readActiveTheme.input.parse({ extra: 1 }));
});
