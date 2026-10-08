import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio } from "./color";
import { parseSpark, sparkPrompt, suggestQuickModel } from "./spark";

const input = { subject: "Spider-Man", moods: ["Neon"], appearance: "any" as const };
const colors = {
  background: "#0b0d1a",
  foreground: "#333344",
  raised: "#12152a",
  control: "#1b2040",
  border: "#262c55",
  accent: "#e11d2e",
  mutedForeground: "#222233",
  ring: "#3b8bff",
};

test("a reply is read out of surrounding prose, bad pieces are dropped, and looks are made readable", () => {
  const reply =
    "Sure!\n```json\n" +
    JSON.stringify({
      subject: "Spider-Man",
      enhanced: "Deep red on midnight blue with ink lines.",
      moods: ["neon", "Comic ink", "Made up"],
      nudges: ["add web lines", 7, "  "],
      looks: [
        { name: "Night swing", appearance: "dark", colors },
        { name: "Broken", appearance: "dark", colors: { ...colors, accent: "red" } },
        { appearance: "light", colors: { ...colors, background: "#F4F1EA", raised: "#FFFFFF", foreground: "#EEEEEE" } },
      ],
    }) +
    "\n```";
  const result = parseSpark(reply, input);
  assert.deepEqual(result.moods, ["Neon", "Comic ink"]);
  assert.deepEqual(result.nudges, ["add web lines"]);
  assert.deepEqual(
    result.looks.map(look => [look.name, look.appearance]),
    [
      ["Night swing", "dark"],
      ["Look 2", "light"],
    ],
  );
  for (const look of result.looks) {
    const workspace = look.appearance === "dark" ? look.colors.raised : look.colors.background;
    assert.ok(contrastRatio(look.colors.foreground, workspace) >= 7);
    assert.ok(contrastRatio(look.colors.mutedForeground, workspace) >= 4.5);
    assert.ok(contrastRatio(look.colors.background, look.colors.accent) >= 4.5);
  }
  assert.equal(result.looks[0].colors.background, "#0B0D1A");
  // A fixed appearance overrides whatever the model labelled.
  assert.equal(parseSpark(reply, { ...input, appearance: "light" }).looks[0].appearance, "light");
  assert.throws(() => parseSpark("no json here", input), /did not answer with JSON/);
  assert.throws(() => parseSpark("{ nope }", input), /not valid JSON/);
});

test("the prompt asks for an invented idea only when there is none", () => {
  assert.match(sparkPrompt(input), /Theme idea so far: "Spider-Man"/);
  assert.match(sparkPrompt(input), /Chosen moods: Neon/);
  assert.match(sparkPrompt({ subject: " ", moods: [], appearance: "dark" }), /Invent a specific, surprising one/);
  assert.match(sparkPrompt({ subject: "", moods: [], appearance: "dark" }), /Every look must be dark/);
});

test("the suggested quick model is a provider's small current model", () => {
  const providers = [
    {
      id: "codex",
      models: [
        { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
        { id: "gpt-6-luna", label: "GPT-6-Luna" },
      ],
    },
    {
      id: "claude",
      models: [
        { id: "claude-opus-5-5", label: "Opus 5.5" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Haiku 4.5 · Previous release" },
        { id: "claude-haiku-5-5", label: "Haiku 5.5", description: "Fastest for quick answers" },
      ],
    },
  ];
  assert.deepEqual(suggestQuickModel(providers), { provider: "claude", model: "claude-haiku-5-5" });
  assert.deepEqual(suggestQuickModel([providers[0]]), { provider: "codex", model: "gpt-6-luna" });
  assert.equal(suggestQuickModel([{ id: "x", models: [{ id: "big", label: "Big" }] }]), null);
});
