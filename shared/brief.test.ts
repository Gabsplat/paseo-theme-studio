import assert from "node:assert/strict";
import test from "node:test";
import { composeBrief, mixPatch, splitTakeName } from "./brief";
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

test("a new brief states the subject, the mix, the context, and how to name the takes", () => {
  const text = composeBrief({
    mode: "new",
    subject: "Spider-Man",
    appearance: "dark",
    moods: ["Comic ink", "Neon"],
    mix: { colors: forest },
    variants: 3,
    context: ["accent #0AFF64"],
  });
  assert.match(text, /inspired by: Spider-Man\./);
  assert.match(text, /dark pack/);
  assert.match(text, /comic ink, neon/);
  assert.match(text, /colors of "Forest dusk"/);
  assert.match(text, /accent #0AFF64/);
  assert.match(text, /3 clearly different takes/);
  assert.match(text, /Short name · what makes it different/);
  assert.match(text, /check_contrast/);
  assert.match(text, /Do not set ui\.panel/);
});

test("a remix starts from the draft and keeps it recognizable, even with no request", () => {
  const base = { appearance: "any" as const, moods: [], mix: {}, variants: 1, context: [] };
  const remix = composeBrief({ ...base, mode: "remix", remixName: "Champions League", subject: "warmer" });
  assert.match(remix, /Remix the pack that is in the draft now, "Champions League"/);
  assert.match(remix, /change this: warmer\./);
  assert.match(composeBrief({ ...base, mode: "remix", subject: "" }), /give me fresh takes on it/);
  assert.match(remix, /Save it with create_variant/);
});

test("take names split into a title and a note", () => {
  assert.deepEqual(splitTakeName("Night swing · alarm red on midnight blue"), {
    title: "Night swing",
    note: "alarm red on midnight blue",
  });
  assert.deepEqual(splitTakeName("Windows 98"), { title: "Windows 98", note: null });
});
