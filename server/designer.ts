import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { ThemeBridge } from "./bridge";
import { RevisionConflict, StudioStore } from "./store";
import { packInstructions, toolDefinitions } from "./capabilities";
import { componentTriggerInstructions } from "../shared/component-trigger-policy";
import { AgentOwners } from "./agent-owners";
import { defaultDesignerModel, defaultDesignerProvider } from "../shared/designer";

const sessionSchema = z.object({ agentId: z.string().uuid(), workspaceId: z.string() }).strict();
type Session = z.infer<typeof sessionSchema>;
const systemPrompt = `You are the user's persistent Paseo Theme Studio pack designer. Collaborate in this native Paseo conversation and use the theme-studio MCP tools to change the draft preview. The user edits the same document manually. ${packInstructions} ${componentTriggerInstructions}
Read read_capabilities to learn supported fields and scope. You can edit pack styles and panels, favorite and reuse saved packs, create reusable composition trees, and generate new React Native TSX components on demand using create_code_component. Use list_components before component mutations. Compile generated code with build_components; only the user activates compiled code. Publish composition rows immediately or activated code rows with publish_component. Component interactions arrive as structured native messages; read_component_instance and update_component_state return your decision to the UI without causing another turn. Use the owning agentId given by the event when publishing related rows. Never treat action names as shell commands. You cannot rewrite Paseo native messages or global layout.
Read read_theme before each set of edits. Use expectedRevision from that read. On a conflict, read again and adapt to the latest user edits. Never overwrite a locked color. Locked colors apply to all changes. Explain an unavailable edit and ask the user to unlock its color when necessary.
Use patch_pack for draft palette and UI changes, check_contrast to check readability, create_variant to edit and save a named draft variant, save_pack to save the current draft, load_preset to start from a preset, and undo/redo to navigate draft history. You may lock_color at the user's request, but you cannot unlock a color. Check text against backgrounds and text on accent buttons. Accent foreground in Paseo is derived from the theme background. Tell the user when a requested contrast target remains unmet.
These tools are the only way to change Theme Studio. Do not edit studio.json, bridge files, the plugin source, the Paseo app, or host configuration. Do not use shell commands or unrelated MCP tools to modify a theme. Keep responses brief and explain concrete visual choices. Preserve the user's manual edits. Never claim a theme is installed, applied, saved, or contrast-compliant unless the tool result confirms it.`;

export class Designer {
  private pending: Promise<Session> | null = null;
  private readonly sessionFile: string;
  constructor(
    private readonly store: StudioStore,
    private readonly bridge: ThemeBridge,
  ) {
    this.sessionFile = join(store.directory, "designer.json");
  }
  start(
    input: { workspaceId?: string; provider?: string; model?: string },
    paseo: PluginHandlerContext["paseo"],
  ): Promise<Session> {
    if (this.pending) return this.pending;
    const operation = this.launch(input, paseo);
    this.pending = operation;
    void operation
      .finally(() => {
        if (this.pending === operation) this.pending = null;
      })
      .catch(() => {});
    return operation;
  }
  private async remember(session: Session) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const document = await this.store.read();
      if (document.designerAgentId === session.agentId && document.designerWorkspaceId === session.workspaceId) return;
      try {
        await this.store.mutate(document.revision, next => ({
          ...next,
          designerAgentId: session.agentId,
          designerWorkspaceId: session.workspaceId,
        }));
        return;
      } catch (error) {
        if (!(error instanceof RevisionConflict)) throw error;
      }
    }
    throw new Error("The designer was created, but the palette kept changing. Retry to reconnect it.");
  }
  private async persistSession(session: Session) {
    const temporary = this.sessionFile + `.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
    await rename(temporary, this.sessionFile);
  }
  private async launch(
    input: { workspaceId?: string; provider?: string; model?: string },
    paseo: PluginHandlerContext["paseo"],
  ): Promise<Session> {
    await this.bridge.ensure();
    const document = await this.store.read();
    let saved: Session | null = null;
    if (document.designerAgentId && document.designerWorkspaceId)
      saved = { agentId: document.designerAgentId, workspaceId: document.designerWorkspaceId };
    if (!saved) {
      try {
        saved = sessionSchema.parse(JSON.parse(await readFile(this.sessionFile, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("The designer session record is invalid. It has been preserved.", { cause: error });
      }
    }
    if (saved) {
      const agentId = saved.agentId;
      const existing = paseo.agents.ref(agentId);
      const refreshed = await existing.refresh().catch(error => {
        // Paseo 0.9.2 throws for a reserved ID whose provider failed to initialize.
        // Only that exact missing-agent response permits retrying creation.
        if (error instanceof Error && error.message === `Agent not found: ${agentId}`) return null;
        throw error;
      });
      if (refreshed && !existing.archivedAt && existing.workspaceId) {
        const result = { agentId: existing.id, workspaceId: existing.workspaceId };
        await this.remember(result);
        return result;
      }
      if (refreshed) saved = null;
      else saved = { ...saved, agentId: randomUUID() };
    }
    let workspace = input.workspaceId
      ? paseo.workspaces.ref(input.workspaceId)
      : saved?.workspaceId
        ? paseo.workspaces.ref(saved.workspaceId)
        : null;
    if (workspace) {
      const refreshed = await workspace.refresh();
      if (!refreshed || refreshed.archivingAt || !workspace.directory) {
        if (input.workspaceId) throw new Error("The selected workspace is unavailable.");
        workspace = null;
        saved = null;
      }
    }
    if (!workspace) {
      const directory = join(this.store.directory, "designer-workspace");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      workspace = await paseo.workspaces.create({
        title: "Theme Studio",
        source: { kind: "directory", path: directory },
      });
    }
    const session = { agentId: saved?.agentId ?? randomUUID(), workspaceId: workspace.id };
    await this.persistSession(session);
    const provider = input.provider?.trim() || defaultDesignerProvider;
    const model = input.model?.trim() || defaultDesignerModel(provider);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(provider) || model.length > 200 || /[\r\n]/.test(model))
      throw new Error("Choose a valid provider and model.");
    const tools = toolDefinitions.map(tool => tool.name);
    // The designer is independently connected even when general-agent opt-in is off.
    // Its reserved native ID is known here, before the provider launches its MCP.
    const owners = new AgentOwners(this.store.directory);
    const owner = owners.allocate();
    await owners.bind(owner.token, session.agentId);
    const agent = await workspace.agents.create({
      agentId: session.agentId,
      title: "Theme designer",
      config: {
        provider: `${provider}/${model}`,
        ...(provider === "codex" ? { thinkingOptionId: "high" } : {}),
        systemPrompt: `${systemPrompt}\nYour own Paseo agent ID is ${session.agentId}. Component publications belong to this conversation unless the user explicitly chooses another target.`,
        mcpServers: {
          "theme-studio": {
            type: "stdio",
            command: process.execPath,
            args: [this.bridge.script, this.bridge.endpoint, owner.path],
          },
        },
        toolPolicy: { preapproved: tools.map(tool => ({ kind: "mcp" as const, server: "theme-studio", tool })) },
      },
    });
    const result = { agentId: agent.id, workspaceId: agent.workspaceId ?? workspace.id };
    await this.persistSession(result);
    await this.remember(result);
    return result;
  }
  async close() {
    if (this.pending) await this.pending.catch(() => {});
  }
}
