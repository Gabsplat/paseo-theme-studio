import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  parseSpark,
  sparkPrompt,
  sparkSystemPrompt,
  suggestQuickModel,
  type SparkInput,
  type SparkModels,
  type SparkResult,
} from "../shared/spark";
import type { PreferencesStore } from "./preferences";
import type { StudioStore } from "./store";

type Paseo = PluginHandlerContext["paseo"];
const sessionSchema = z.object({ agentId: z.string(), key: z.string(), uses: z.number().int().nonnegative() }).strict();
type Session = z.infer<typeof sessionSchema>;
/** A helper's conversation is thrown away after this many answers so every answer stays quick. */
const usesPerSession = 12;
const modelsTtlMs = 5 * 60 * 1000;
const answerTimeoutMs = 60000;
// The least reasoning a model offers; ideas want speed, not depth.
const quickThinking = /^(none|off|minimal|low)$/i;

/**
 * Instant ideas and looks from a small, fast model the user picks. It runs as a
 * plain helper agent with no tools; its JSON answer is validated and repaired here.
 */
export class Spark {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private models: { at: number; value: SparkModels; thinking: Map<string, string> } | null = null;
  constructor(
    private readonly store: Pick<StudioStore, "read" | "directory">,
    private readonly preferences: Pick<PreferencesStore, "read">,
  ) {
    this.file = join(store.directory, "spark.json");
  }

  /** Models of every provider that works on this host. */
  async listModels(paseo: Paseo): Promise<SparkModels> {
    if (this.models && Date.now() - this.models.at < modelsTtlMs) return this.models.value;
    const available = (await paseo.providers.listAvailable()).providers.filter(item => item.available);
    const thinking = new Map<string, string>();
    const providers = (
      await Promise.all(
        available.map(async ({ provider }) => {
          try {
            const models = (await paseo.providers.listModels(provider)).models ?? [];
            for (const model of models) {
              const option = model.thinkingOptions?.find(item => quickThinking.test(item.id));
              if (option) thinking.set(`${provider}/${model.id}`, option.id);
            }
            return {
              id: provider,
              models: models
                .filter(model => model.isSelectable !== false)
                .map(model => ({
                  id: model.id,
                  label: model.label,
                  ...(model.description ? { description: model.description } : {}),
                })),
            };
          } catch {
            return { id: provider, models: [] };
          }
        }),
      )
    ).filter(provider => provider.models.length);
    const value = { providers, suggested: suggestQuickModel(providers) };
    this.models = { at: Date.now(), value, thinking };
    return value;
  }

  private async choice(paseo: Paseo): Promise<{ provider: string; model: string; label: string }> {
    const models = await this.listModels(paseo);
    const preferences = await this.preferences.read();
    const chosen =
      preferences.sparkProvider && preferences.sparkModel
        ? { provider: preferences.sparkProvider, model: preferences.sparkModel }
        : models.suggested;
    if (!chosen) throw new Error("No model is available for quick ideas. Set up a provider in Paseo first.");
    const label =
      models.providers.find(item => item.id === chosen.provider)?.models.find(item => item.id === chosen.model)
        ?.label ?? chosen.model;
    return { ...chosen, label };
  }

  private async readSession(): Promise<Session | null> {
    try {
      return sessionSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      return null;
    }
  }

  private async retire(paseo: Paseo, session: Session | null) {
    await rm(this.file, { force: true });
    if (session)
      await paseo.agents
        .ref(session.agentId)
        .archive()
        .catch(() => {});
  }

  /** The helper for this model, reused while it is healthy and its conversation is short. */
  private async helper(paseo: Paseo, provider: string, model: string) {
    const key = `${provider}/${model}`;
    let session = await this.readSession();
    if (session && (session.key !== key || session.uses >= usesPerSession)) {
      await this.retire(paseo, session);
      session = null;
    }
    if (session) {
      const agent = paseo.agents.ref(session.agentId);
      const refreshed = await agent.refresh().catch(() => null);
      const usable =
        refreshed &&
        !agent.archivedAt &&
        !refreshed.agent.providerUnavailable &&
        agent.status === "idle" &&
        !agent.activeTurn;
      if (usable) return { agent, session };
      await this.retire(paseo, session);
    }
    const directory = join(this.store.directory, "designer-workspace");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const thinking = this.models?.thinking.get(key);
    const options = {
      title: "Theme spark",
      config: {
        provider: key,
        systemPrompt: sparkSystemPrompt,
        ...(thinking ? { thinkingOptionId: thinking } : {}),
      },
    };
    // Sit beside the designer when it has a workspace; otherwise Paseo places the helper by directory.
    const workspaceId = (await this.store.read()).designerWorkspaceId;
    const workspace = workspaceId ? paseo.workspaces.ref(workspaceId) : null;
    const refreshed = workspace ? await workspace.refresh().catch(() => null) : null;
    const placed = workspace && refreshed && !refreshed.archivingAt;
    const agent = placed
      ? await workspace.agents.create(options)
      : await paseo.agents.create({ ...options, cwd: directory });
    const created = { agentId: agent.id, key, uses: 0 };
    await writeFile(this.file, JSON.stringify(created), { mode: 0o600 });
    return { agent, session: created };
  }

  ask(input: SparkInput, paseo: Paseo): Promise<SparkResult & { model: string; milliseconds: number }> {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const started = Date.now();
        const { provider, model, label } = await this.choice(paseo);
        const { agent, session } = await this.helper(paseo, provider, model);
        const result = await agent.run(sparkPrompt(input), { timeoutMs: answerTimeoutMs });
        if (result.status !== "idle" || !result.lastMessage) {
          await this.retire(paseo, session);
          throw new Error(
            result.status === "timeout"
              ? `${label} took too long. Try again, or pick a faster quick model.`
              : result.status === "permission"
                ? `${label} tried to use a tool instead of answering. Try again.`
                : `${label} could not answer. ${result.error ?? "Try again, or pick another quick model."}`,
          );
        }
        await writeFile(this.file, JSON.stringify({ ...session, uses: session.uses + 1 }), { mode: 0o600 });
        return { ...parseSpark(result.lastMessage, input), model: label, milliseconds: Date.now() - started };
      });
    this.queue = operation;
    return operation;
  }

  async close() {
    await this.queue.catch(() => {});
  }
}
