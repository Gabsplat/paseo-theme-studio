import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import type { StudioTheme } from "../shared/theme";

export const packToolCardSchema = z.object({
  label: z.string(),
  kind: z.enum(["shell", "plain_text"]),
  command: z.string().optional(),
  cwd: z.string().optional(),
  output: z.string(),
  exitCode: z.number().nullable().optional(),
}).strict();
export type PackToolData = z.infer<typeof packToolCardSchema>;

type ToolTransformer = PluginTimelineTransformerContribution<"tool_call">["transform"];
export const transformPackTool: (pack: StudioTheme | null, input: Parameters<ToolTransformer>[0]) => ReturnType<ToolTransformer> = (pack, { item, phase }) => {
  if (!pack || pack.ui.toolCards === "native" || phase !== "complete" || item.status !== "completed" || item.error !== null) return;
  // These completed text-only types have no permission, navigation, or agent actions.
  // All other native tools retain their original renderer and interactions.
  const detail = item.detail;
  if (detail.type !== "shell" && detail.type !== "plain_text") return;
  // A provider may mark a finished command completed even when its exit code failed.
  // Keep that command's native error presentation instead of showing a success card.
  if (detail.type === "shell" && detail.exitCode !== undefined && detail.exitCode !== null && detail.exitCode !== 0) return;
  const data: PackToolData = detail.type === "shell" ? { label: item.name, kind: "shell", command: detail.command, ...(detail.cwd === undefined ? {} : { cwd: detail.cwd }), output: detail.output ?? "", ...(detail.exitCode === undefined ? {} : { exitCode: detail.exitCode }) } : { label: detail.label ?? item.name, kind: "plain_text", output: detail.text ?? "" };
  // Keep the native row when its complete data would exceed the plugin payload budget.
  // No original command or output is truncated by this transformation.
  if (JSON.stringify(data).length > 14000) return;
  return { items: [{ type: "plugin", id: item.callId, kind: "theme-pack-tool", version: 1, data }] };
};
