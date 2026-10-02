import { z } from "zod";
import { packUiSchema, defaultPackUi } from "./pack";
export { packUiSchema, panelIcons, type PackUi } from "./pack";

export const colorKeys = [
  "background",
  "foreground",
  "raised",
  "control",
  "border",
  "accent",
  "mutedForeground",
  "ring",
] as const;
export type ColorKey = (typeof colorKeys)[number];
export const colorLabels: Record<ColorKey, string> = {
  background: "Background",
  foreground: "Text",
  raised: "Raised",
  control: "Control",
  border: "Border",
  accent: "Accent",
  mutedForeground: "Muted text",
  ring: "Ring",
};
export const hexSchema = z.string().regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/);
export const paletteSchema = z
  .object({
    background: hexSchema,
    foreground: hexSchema,
    raised: hexSchema,
    control: hexSchema,
    border: hexSchema,
    accent: hexSchema,
    mutedForeground: hexSchema,
    ring: hexSchema,
  })
  .strict();
export type Palette = z.infer<typeof paletteSchema>;
export const themeSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(60),
    appearance: z.enum(["light", "dark"]),
    colors: paletteSchema,
    ui: packUiSchema.default(() => JSON.parse(JSON.stringify(defaultPackUi))),
  })
  .strict();
export type StudioTheme = z.infer<typeof themeSchema>;
export const forestTheme: StudioTheme = {
  id: "forest-dusk",
  name: "Forest dusk",
  appearance: "dark",
  ui: defaultPackUi,
  colors: {
    background: "#181A17",
    foreground: "#E5E8DF",
    raised: "#232720",
    control: "#2B3328",
    border: "#30392E",
    accent: "#6CA67A",
    mutedForeground: "#A3AF99",
    ring: "#718368",
  },
};
export const presets: StudioTheme[] = [
  forestTheme,
  {
    id: "paseo",
    name: "Paseo",
    appearance: "dark",
    ui: defaultPackUi,
    colors: {
      background: "#121815",
      foreground: "#FAFAFA",
      raised: "#1B211E",
      control: "#27302B",
      border: "#354039",
      accent: "#2D8B62",
      mutedForeground: "#A1AAA5",
      ring: "#718078",
    },
  },
  {
    id: "warm-moss",
    name: "Warm moss",
    appearance: "dark",
    ui: defaultPackUi,
    colors: {
      background: "#1D1E18",
      foreground: "#EBE8D8",
      raised: "#292B21",
      control: "#35382A",
      border: "#414532",
      accent: "#B0BE84",
      mutedForeground: "#A4AB90",
      ring: "#737D5F",
    },
  },
  {
    id: "mocha",
    name: "Catppuccin",
    appearance: "dark",
    ui: defaultPackUi,
    colors: {
      background: "#1E1E2E",
      foreground: "#CDD6F4",
      raised: "#313244",
      control: "#45475A",
      border: "#45475A",
      accent: "#CBA6F7",
      mutedForeground: "#A6ADC8",
      ring: "#6C7086",
    },
  },
  {
    id: "paper",
    name: "Paper",
    appearance: "light",
    ui: defaultPackUi,
    colors: {
      background: "#F7F6F0",
      foreground: "#252A25",
      raised: "#FFFFFF",
      control: "#ECEEE5",
      border: "#D6DCCF",
      accent: "#356647",
      mutedForeground: "#626E61",
      ring: "#8A9887",
    },
  },
];
const historyEntrySchema = z.object({
  theme: themeSchema,
  label: z.string(),
  source: z.enum(["manual", "agent", "preset", "system"]),
  at: z.string(),
});
export const documentSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  current: themeSchema,
  baseline: themeSchema,
  locks: z.array(z.enum(colorKeys)),
  saved: z.array(themeSchema),
  favorites: z.array(z.string()).default([]),
  history: z.array(historyEntrySchema),
  cursor: z.number().int().nonnegative(),
  designerAgentId: z.string().nullable(),
  designerWorkspaceId: z.string().nullable(),
  active: themeSchema.nullable().default(null),
  previousActive: themeSchema.nullable().default(null),
});
export type StudioDocument = z.infer<typeof documentSchema>;
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("patch-ui"), ui: packUiSchema.partial(), label: z.string().max(200).optional() }),
  z.object({ type: z.literal("activate") }),
  z.object({ type: z.literal("revert-active") }),
  z.object({ type: z.literal("disable-pack") }),
  z.object({
    type: z.literal("patch"),
    colors: paletteSchema.partial().default({}),
    ui: packUiSchema.partial().optional(),
    name: z.string().min(1).max(60).optional(),
    appearance: z.enum(["light", "dark"]).optional(),
    label: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("lock"), key: z.enum(colorKeys), locked: z.boolean() }),
  z.object({ type: z.literal("preset"), id: z.string() }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
  z.object({ type: z.literal("save"), name: z.string().min(1).max(60).optional() }),
  z.object({ type: z.literal("load"), id: z.string() }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({ type: z.literal("favorite"), id: z.string() }),
  z.object({ type: z.literal("unfavorite"), id: z.string() }),
  z.object({ type: z.literal("import"), theme: themeSchema }),
]);
export type StudioAction = z.infer<typeof actionSchema>;
export function initialDocument(): StudioDocument {
  return {
    version: 1,
    revision: 0,
    current: forestTheme,
    baseline: forestTheme,
    locks: [],
    saved: [],
    favorites: [],
    history: [{ theme: forestTheme, label: "Starting palette", source: "system", at: new Date().toISOString() }],
    cursor: 0,
    designerAgentId: null,
    designerWorkspaceId: null,
    active: forestTheme,
    previousActive: null,
  };
}

/** Names only effects that our public plugin extension points can apply. */
export function describePackChanges(draft: StudioTheme, active: StudioTheme | null): string[] {
  if (!active) return ["Paseo palette", "Pack extensions"];
  const changes: string[] = [];
  if (JSON.stringify(draft.colors) !== JSON.stringify(active.colors) || draft.appearance !== active.appearance)
    changes.push("Paseo palette");
  if (draft.ui.toolCards !== active.ui.toolCards) changes.push("Completed shell tool cards");
  if (draft.ui.messageStyle !== active.ui.messageStyle) changes.push("Pack note style");
  if (
    ["density", "radius", "fontFamily", "fontSize"].some(
      key => draft.ui[key as keyof typeof draft.ui] !== active.ui[key as keyof typeof active.ui],
    )
  )
    changes.push("Pack component styles");
  if (draft.ui.activityPanel !== active.ui.activityPanel) changes.push("Workspace activity panel");
  if (JSON.stringify(draft.ui.panel) !== JSON.stringify(active.ui.panel)) changes.push("Custom design panel");
  if (draft.name !== active.name) changes.push("Pack name");
  return changes;
}
