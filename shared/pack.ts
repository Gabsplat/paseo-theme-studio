import { z } from "zod";

export const panelIcons = [
  "Activity",
  "Gauge",
  "ListTodo",
  "Sparkles",
  "LayoutDashboard",
  "BookOpen",
  "Terminal",
  "Palette",
] as const;
export const panelBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(600) }).strict(),
  z.object({ type: z.literal("stat"), label: z.string().max(60), value: z.string().max(80) }).strict(),
  z
    .object({ type: z.literal("list"), title: z.string().max(60), items: z.array(z.string().max(180)).max(12) })
    .strict(),
  z.object({ type: z.literal("progress"), label: z.string().max(60), value: z.number().min(0).max(100) }).strict(),
]);
export const packUiSchema = z
  .object({
    density: z.enum(["compact", "comfortable", "spacious"]),
    radius: z.number().int().min(0).max(24),
    fontFamily: z.enum(["system", "mono", "serif"]),
    fontSize: z.number().int().min(11).max(18),
    toolCards: z.enum(["native", "compact", "bordered"]),
    messageStyle: z.enum(["plain", "card"]),
    activityPanel: z.boolean(),
    panel: z
      .object({
        enabled: z.boolean(),
        title: z.string().trim().min(1).max(48),
        icon: z.enum(panelIcons),
        blocks: z.array(panelBlockSchema).max(12),
      })
      .strict(),
  })
  .strict();
export type PackUi = z.infer<typeof packUiSchema>;
export type PanelBlock = z.infer<typeof panelBlockSchema>;
export const defaultPackUi: PackUi = {
  density: "comfortable",
  radius: 10,
  fontFamily: "system",
  fontSize: 13,
  toolCards: "native",
  messageStyle: "plain",
  activityPanel: false,
  panel: { enabled: false, title: "Design panel", icon: "Sparkles", blocks: [] },
};
export const uiSchema = packUiSchema;
