import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { actionSchema, documentSchema, themeSchema } from "./theme";
export const readStudio = defineRpc({ name: "studio.read", input: z.object({}), output: documentSchema });
// Returns only the active pack so clients can register the theme without downloading the whole document.
export const readActiveTheme = defineRpc({
  name: "studio.active-theme",
  input: z.object({}).strict(),
  output: themeSchema.nullable(),
});
export const changeStudio = defineRpc({
  name: "studio.change",
  input: z.object({ expectedRevision: z.number().int(), action: actionSchema }),
  output: documentSchema,
});
export const startDesigner = defineRpc({
  name: "studio.designer",
  input: z.object({
    workspaceId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    /** Start a new designer session instead of reopening the current one. */
    fresh: z.boolean().optional(),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string() }),
});

export const exportPack = defineRpc({
  name: "studio.export-pack",
  input: z.object({ expectedRevision: z.number().int().nonnegative(), name: z.string().min(1).max(60).optional() }),
  output: z.object({
    directory: z.string(),
    files: z.array(z.string()),
    validation: z.object({ typecheck: z.boolean() }),
    installCommand: z.string(),
  }),
});
