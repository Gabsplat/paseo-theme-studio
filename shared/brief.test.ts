import assert from "node:assert/strict";
import test from "node:test";
import { composeBrief, mixPatch } from "./brief";
import { presets } from "./theme";

const [forest, paseo, moss] = presets;

test("a mix borrows each slot from its own pack and never touches locked colors", () => {
  const shape = { ...paseo, ui: { ...paseo.ui, radius: 2, density: "compact" as const } };
  const type = { ...moss, ui: { ...moss.ui, fontFamily: "mono" as const, toolCards: "bordered" as const } };
  const patch = mixPatch({ colors: forest, shape, type }, ["accent"]);
  assert.equal(patch.colors.accent, undefined);
  assert.equal(patch.colors.background, forest.colors.background);
  assert.equal(patch.appearance, "dark");
  assert.deepEqual(patch.ui, {
    radius: 2,
    density: "compact",
    fontFamily: "mono",
    fontSize: moss.ui.fontSize,
    toolCards: "bordered",
    messageStyle: moss.ui.messageStyle,
  });
  assert.deepEqual(mixPatch({ shape }, []), { colors: {}, ui: { radius: 2, density: "compact" } });
});

test("the brief states the subject, the mix, the context, and how many takes to save", () => {
  const text = composeBrief({
    subject: "Spider-Man",
    appearance: "dark",
    moods: ["Comic ink", "Neon"],
    mix: { colors: forest },
    extras: ["contrast"],
    variants: 3,
    context: ["accent #0AFF64"],
  });
  assert.match(text, /inspired by: Spider-Man\./);
  assert.match(text, /dark pack/);
  assert.match(text, /comic ink, neon/);
  assert.match(text, /colors of "Forest dusk"/);
  assert.match(text, /accent #0AFF64/);
  assert.match(text, /3 clearly different takes/);
  assert.match(text, /create_variant/);
  assert.match(text, /check_contrast/);
  const single = composeBrief({
    subject: "",
    appearance: "any",
    moods: [],
    mix: {},
    extras: [],
    variants: 1,
    context: [],
  });
  assert.doesNotMatch(single, /create_variant/);
  assert.match(single, /patch_pack/);
});
