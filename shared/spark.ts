import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { briefMoods } from "./brief";
import { repairPalette } from "./harmony";
import { colorKeys, paletteSchema, type Palette } from "./theme";

/** One instant look proposed by the quick model. */
export const sparkLookSchema = z
  .object({ name: z.string().trim().min(1).max(40), appearance: z.enum(["dark", "light"]), colors: paletteSchema })
  .strict();
export type SparkLook = z.infer<typeof sparkLookSchema>;
export const sparkResultSchema = z
  .object({
    /** A short name for the idea; invented when the user asked to be surprised. */
    subject: z.string().max(120),
    /** The idea rewritten as a vivid one-sentence brief. */
    enhanced: z.string().max(500),
    moods: z.array(z.string()).max(4),
    /** Short additions the user can tap to push the idea further. */
    nudges: z.array(z.string().max(60)).max(4),
    looks: z.array(sparkLookSchema).max(4),
  })
  .strict();
export type SparkResult = z.infer<typeof sparkResultSchema>;
export const sparkInputSchema = z
  .object({
    /** Empty asks the model to invent an idea. */
    subject: z.string().max(600),
    moods: z.array(z.string().max(40)).max(10),
    appearance: z.enum(["any", "dark", "light"]),
  })
  .strict();
export type SparkInput = z.infer<typeof sparkInputSchema>;

export const sparkSystemPrompt =
  "You are a fast idea helper inside a theme design tool. You never use tools, never ask questions, and never explain. Every reply is exactly one JSON object and nothing else: no prose, no code fence.";

export function sparkPrompt(input: SparkInput): string {
  const subject = input.subject.trim();
  return [
    subject
      ? `Theme idea so far: ${JSON.stringify(subject)}.`
      : "There is no idea yet. Invent a specific, surprising one (a film, place, era, object, game, or material) and use it.",
    input.moods.length ? `Chosen moods: ${input.moods.join(", ")}.` : "",
    input.appearance === "any" ? "" : `Every look must be ${input.appearance}.`,
    "Reply with one JSON object with exactly these keys:",
    '"subject": the idea as a short name, at most 6 words.',
    '"enhanced": one vivid sentence, at most 40 words, that turns the idea into a brief for an app theme: its colors, shapes, texture, and feeling. Keep what the user wrote.',
    `"moods": up to 3 that fit, chosen only from: ${briefMoods.join(", ")}.`,
    '"nudges": 3 short additions, at most 5 words each, that would push the idea somewhere more specific or more daring.',
    '"looks": 3 clearly different palettes for the idea, each {"name": two words, "appearance": "dark" or "light", "colors": {"background","foreground","raised","control","border","accent","mutedForeground","ring"}} with every color as #RRGGBB.',
    "Palette rules: in a dark look background is the darkest surface, raised is slightly lighter, control lighter again, border a quiet edge, foreground near white, mutedForeground a readable grey. A light look is the reverse, with raised near white. The accent is the idea's signature color and ring is a second signature color.",
  ]
    .filter(Boolean)
    .join("\n");
}

const hex = /^#[0-9a-fA-F]{6}$/;

/**
 * Reads the quick model's reply. Anything malformed is dropped piece by piece, so one
 * bad palette never costs the rest, and every look is repaired until its text reads.
 */
export function parseSpark(text: string, input: SparkInput): SparkResult {
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The quick model did not answer with JSON.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The quick model's answer was not valid JSON.");
  }
  const strings = (value: unknown, limit: number, length: number) =>
    (Array.isArray(value) ? value : [])
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map(item => item.trim().slice(0, length))
      .slice(0, limit);
  const looks: SparkLook[] = [];
  for (const item of Array.isArray(raw.looks) ? raw.looks : []) {
    if (!item || typeof item !== "object") continue;
    const look = item as Record<string, unknown>;
    const colors = (look.colors ?? {}) as Record<string, unknown>;
    if (!colorKeys.every(key => typeof colors[key] === "string" && hex.test(colors[key] as string))) continue;
    const appearance = input.appearance !== "any" ? input.appearance : look.appearance === "light" ? "light" : "dark";
    const palette = Object.fromEntries(colorKeys.map(key => [key, (colors[key] as string).toUpperCase()])) as Palette;
    looks.push({
      name: (typeof look.name === "string" && look.name.trim() ? look.name.trim() : `Look ${looks.length + 1}`).slice(
        0,
        40,
      ),
      appearance,
      colors: repairPalette(palette, appearance),
    });
    if (looks.length === 4) break;
  }
  const allowed = new Map(briefMoods.map(mood => [mood.toLowerCase(), mood]));
  return sparkResultSchema.parse({
    subject: (typeof raw.subject === "string" && raw.subject.trim() ? raw.subject.trim() : input.subject.trim()).slice(
      0,
      120,
    ),
    enhanced: (typeof raw.enhanced === "string" ? raw.enhanced.trim() : "").slice(0, 500),
    moods: [...new Set(strings(raw.moods, 8, 40).flatMap(mood => allowed.get(mood.toLowerCase()) ?? []))].slice(0, 4),
    nudges: strings(raw.nudges, 4, 60),
    looks,
  });
}

const modelSchema = z.object({ id: z.string(), label: z.string(), description: z.string().optional() }).strict();
export const sparkModelsSchema = z
  .object({
    providers: z.array(z.object({ id: z.string(), models: z.array(modelSchema) }).strict()),
    /** A fast, inexpensive model found on this host, used until the user picks one. */
    suggested: z.object({ provider: z.string(), model: z.string() }).strict().nullable(),
  })
  .strict();
export type SparkModels = z.infer<typeof sparkModelsSchema>;

/** Names that mark a provider's small, fast model. */
const quickNames = /haiku|luna|flash|mini|nano|lite|small|fast/i;
const olderNames = /previous|older|legacy|preview/i;
export const isQuickModel = (model: { id: string; label: string }) => quickNames.test(`${model.id} ${model.label}`);
export function suggestQuickModel(providers: SparkModels["providers"]): SparkModels["suggested"] {
  const order = ["claude", "codex", "opencode"];
  const ranked = [...providers].sort(
    (a, b) => (order.indexOf(a.id) + 1 || order.length + 1) - (order.indexOf(b.id) + 1 || order.length + 1),
  );
  for (const provider of ranked) {
    const quick = provider.models.filter(model => quickNames.test(`${model.id} ${model.label}`));
    const model = quick.find(item => !olderNames.test(item.description ?? "")) ?? quick[0];
    if (model) return { provider: provider.id, model: model.id };
  }
  return null;
}

export const readSparkModels = defineRpc({
  name: "studio.spark-models",
  input: z.object({}).strict(),
  output: sparkModelsSchema,
});
export const runSpark = defineRpc({
  name: "studio.spark",
  input: sparkInputSchema,
  output: sparkResultSchema.extend({ model: z.string(), milliseconds: z.number().nonnegative() }),
});
