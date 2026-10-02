import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { toolDefinitions } from "./capabilities";
import type { ThemeBridge } from "./bridge";
import { ownerTokenEnvironment } from "./agent-owners";
import { componentTriggerInstructions } from "../shared/component-trigger-policy";

type Creation = PluginBeforeRequests["agent.create"];
const marker = "[Theme Studio component integration]";
const instructions = `${marker}
Theme Studio MCP can create interactive native cards inside this agent's chat. ${componentTriggerInstructions} Read read_theme for current capabilities, then list_components before editing definitions. Publish with agentId set to your own Paseo agent ID, never the dedicated designer by default. Inputs save without a model turn; explicit buttons and submissions arrive as structured component events. Interpret the selected option in the context of your task, read the current instance, and return results through update_component_state. Keep technical event payloads out of your prose. Existing permission and task instructions still apply. Generated code requires manual activation; do not activate themes or code for the user.`;

export function connectAgent(
  request: Creation,
  bridge: Pick<ThemeBridge, "script" | "endpoint">,
  command = process.execPath,
  owner?: { token: string; path: string },
): Creation {
  if (request.config.internal || !["codex", "claude", "opencode"].includes(request.config.provider)) return request;
  const current = request.config.mcpServers?.["theme-studio"];
  const base = { type: "stdio" as const, command, args: [bridge.script, bridge.endpoint] };
  const managed = { ...base, args: [...base.args, ...(owner ? [owner.path] : [])] };
  // Keep an explicit same-name MCP belonging to the user's configuration.
  if (
    current &&
    JSON.stringify(current) !== JSON.stringify(managed) &&
    JSON.stringify(current) !== JSON.stringify(base)
  )
    return request;
  const preapproved = [...(request.config.toolPolicy?.preapproved ?? [])];
  for (const tool of toolDefinitions) {
    if (!preapproved.some(ref => ref.server === "theme-studio" && ref.tool === tool.name))
      preapproved.push({ kind: "mcp", server: "theme-studio", tool: tool.name });
  }
  return {
    ...request,
    ...(owner ? { env: { ...request.env, [ownerTokenEnvironment]: owner.token } } : {}),
    config: {
      ...request.config,
      mcpServers: { ...request.config.mcpServers, "theme-studio": managed },
      toolPolicy: { ...request.config.toolPolicy, preapproved },
      systemPrompt: request.config.systemPrompt?.includes(marker)
        ? request.config.systemPrompt
        : [request.config.systemPrompt, instructions].filter(Boolean).join("\n\n"),
    },
  };
}
