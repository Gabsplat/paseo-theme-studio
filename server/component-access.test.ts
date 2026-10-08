import assert from "node:assert/strict";
import { test } from "node:test";
import { assertComponentTarget, assertCustomComponent } from "./component-access";

const self = "11111111-2222-4333-8444-555555555555";
const other = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const designer = "99999999-8888-4777-8666-555555555555";

test("agents may only target their own conversation unless they are the designer", () => {
  assert.doesNotThrow(() => assertComponentTarget(self, self, designer));
  assert.doesNotThrow(() => assertComponentTarget(designer, other, designer));
  assert.throws(() => assertComponentTarget(self, other, designer), /their own conversation/);
  assert.throws(() => assertComponentTarget(self, other, null), /their own conversation/);
  assert.throws(() => assertComponentTarget(undefined, self, designer), /could not verify/);
});

test("only custom components can be published or triggered; retired compositions are refused", () => {
  const library = {
    definitions: [
      { id: "blocks", version: 1, mode: "composition" },
      { id: "mixed", version: 1, mode: "composition" },
      { id: "mixed", version: 2, mode: "code" },
      { id: "custom", version: 1, mode: "code" },
    ],
  } as never;
  assertCustomComponent(library, "custom");
  assertCustomComponent(library, "custom", 1);
  // The latest version decides when none is named.
  assertCustomComponent(library, "mixed");
  assert.throws(() => assertCustomComponent(library, "mixed", 1), /only uses custom components/);
  assert.throws(() => assertCustomComponent(library, "blocks"), /create_code_component/);
  // Unknown components are reported by the publisher, not here.
  assertCustomComponent(library, "missing");
});
