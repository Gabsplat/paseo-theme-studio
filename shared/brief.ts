import type { ColorKey, PackUi, Palette, StudioTheme } from "./theme";

export const briefMoods = [
  "Playful",
  "Minimal",
  "Retro",
  "Neon",
  "Editorial",
  "Soft",
  "Terminal",
  "High contrast",
  "Comic ink",
  "Cinematic",
] as const;
export const briefExtras = [
  { id: "card", label: "A matching chat card", prompt: "Also create one native chat card that fits this look." },
  {
    id: "panel",
    label: "A workspace panel",
    prompt: "Add a workspace panel with a short checklist and a progress bar that suit the theme.",
  },
  {
    id: "contrast",
    label: "Check contrast",
    prompt: "Run check_contrast and fix any text pair under 4.5:1 before you finish.",
  },
] as const;
export type BriefExtra = (typeof briefExtras)[number]["id"];

/** Which part of a pack a mix slot borrows. */
export const mixSlots = [
  { id: "colors", label: "Colors", detail: "All eight palette colors and light or dark." },
  { id: "shape", label: "Shape and density", detail: "Corner radius and spacing." },
  { id: "type", label: "Type and cards", detail: "Font, size, tool cards, and note style." },
] as const;
export type MixSlot = (typeof mixSlots)[number]["id"];
export type Mix = Partial<Record<MixSlot, StudioTheme>>;

export type Brief = {
  subject: string;
  appearance: "any" | "dark" | "light";
  moods: readonly string[];
  mix: Mix;
  extras: readonly BriefExtra[];
  variants: number;
  /** Things the user pointed at in the preview, such as "accent #0AFF64". */
  context: readonly string[];
};

/**
 * The patch that applies a mix to the draft without a model turn. Locked colors
 * are left out so the rest of the mix still applies.
 */
export function mixPatch(
  mix: Mix,
  locks: readonly ColorKey[],
): { colors: Partial<Palette>; appearance?: "light" | "dark"; ui?: Partial<PackUi> } {
  const colors: Partial<Palette> = {};
  if (mix.colors)
    for (const [key, value] of Object.entries(mix.colors.colors) as [ColorKey, string][])
      if (!locks.includes(key)) colors[key] = value;
  const ui: Partial<PackUi> = {
    ...(mix.shape ? { radius: mix.shape.ui.radius, density: mix.shape.ui.density } : {}),
    ...(mix.type
      ? {
          fontFamily: mix.type.ui.fontFamily,
          fontSize: mix.type.ui.fontSize,
          toolCards: mix.type.ui.toolCards,
          messageStyle: mix.type.ui.messageStyle,
        }
      : {}),
  };
  return {
    colors,
    ...(mix.colors ? { appearance: mix.colors.appearance } : {}),
    ...(Object.keys(ui).length ? { ui } : {}),
  };
}

export const mixIsEmpty = (mix: Mix) => !mix.colors && !mix.shape && !mix.type;

/** Turns the builder's choices into the message the designer receives. */
export function composeBrief(brief: Brief): string {
  const lines: string[] = [];
  const subject = brief.subject.trim();
  lines.push(
    subject ? `Design a Paseo pack inspired by: ${subject}.` : "Design a new Paseo pack from the direction below.",
  );
  if (brief.appearance !== "any") lines.push(`Make it a ${brief.appearance} pack.`);
  if (brief.moods.length) lines.push(`Mood: ${brief.moods.join(", ").toLowerCase()}.`);
  const borrowed: string[] = [];
  if (brief.mix.colors) borrowed.push(`the colors of "${brief.mix.colors.name}" as the starting palette`);
  if (brief.mix.shape)
    borrowed.push(
      `the shape of "${brief.mix.shape.name}" (radius ${brief.mix.shape.ui.radius}, ${brief.mix.shape.ui.density} density)`,
    );
  if (brief.mix.type)
    borrowed.push(
      `the type and cards of "${brief.mix.type.name}" (${brief.mix.type.ui.fontFamily} ${brief.mix.type.ui.fontSize}px, ${brief.mix.type.ui.toolCards} tool cards)`,
    );
  if (borrowed.length)
    lines.push(
      `I already mixed these into the draft, so keep them unless they fight the idea: ${borrowed.join("; ")}.`,
    );
  if (brief.context.length) lines.push(`I am pointing at: ${brief.context.join("; ")}. Treat these as the focus.`);
  lines.push(
    brief.variants > 1
      ? `Give me ${brief.variants} clearly different takes. Save each one with create_variant under a short descriptive name, and leave the strongest one in the draft.`
      : "Apply it to the draft with patch_pack and name the pack after the idea.",
  );
  for (const extra of briefExtras) if (brief.extras.includes(extra.id)) lines.push(extra.prompt);
  lines.push(
    "Read read_theme first, respect locked colors, and keep text readable. Reply with one short line per take saying what makes it different.",
  );
  return lines.join("\n");
}

/** A note about the current draft, with whatever the user pointed at in the preview. */
export function composeFeedback(note: string, context: readonly string[]): string {
  const lines = [note.trim() || "Improve what I am pointing at in the current draft."];
  if (context.length) lines.push(`I am pointing at: ${context.join("; ")}.`);
  lines.push("Read read_theme first, change only what this asks for, and respect locked colors.");
  return lines.join("\n");
}
