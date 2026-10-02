import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const agentConnectionSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    automaticTriggers: z.boolean().default(true),
  })
  .strict();
export type AgentConnection = z.infer<typeof agentConnectionSchema>;
export const readAgentConnection = defineRpc({
  name: "studio.agent-connection",
  input: z.object({}).strict(),
  output: agentConnectionSchema,
});
export const changeAgentConnection = defineRpc({
  name: "studio.change-agent-connection",
  input: z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      enabled: z.boolean().optional(),
      automaticTriggers: z.boolean().optional(),
    })
    .strict()
    .refine(
      value => value.enabled !== undefined || value.automaticTriggers !== undefined,
      "Choose a connection or trigger setting.",
    ),
  output: agentConnectionSchema,
});
export const readAgentMcpSetup = defineRpc({
  name: "studio.agent-mcp-setup",
  input: z.object({ provider: z.enum(["codex", "claude", "opencode"]) }).strict(),
  output: z.object({ configuration: z.string(), instructions: z.string() }).strict(),
});
