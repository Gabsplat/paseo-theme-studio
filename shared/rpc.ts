import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { actionSchema, documentSchema } from "./theme";
export const readStudio = defineRpc({ name: "studio.read", input: z.object({}), output: documentSchema });
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
