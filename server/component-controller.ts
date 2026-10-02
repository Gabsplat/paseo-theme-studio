import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  componentActionSchema,
  componentIdSchema,
  componentStateSchema,
  componentTimelineSchema,
  type ComponentAction,
  type ComponentDefinition,
  type ComponentEvent,
  type ComponentInstance,
  type ComponentLibrary,
  type ComponentState,
  type ComponentTrigger,
} from "../shared/components";
import type { StudioStore } from "./store";
import { componentEventPrompt } from "../shared/component-event";
import { ComponentRevisionConflict } from "./components";

export interface ComponentControllerService {
  read(): Promise<ComponentLibrary>;
  createInstance(input: {
    expectedRevision: number;
    componentId: string;
    version?: number;
    agentId: string;
    state?: ComponentState;
    trigger?: {
      id: string;
      event: ComponentTrigger["event"];
      turnId: string;
      turnStartedAt: string;
      occurrenceKey: string;
    };
  }): Promise<{ library: ComponentLibrary; instance: ComponentInstance; reused?: boolean }>;
  readInstance(instanceId: string): Promise<ComponentInstance>;
  interact(input: {
    instanceId: string;
    expectedRevision: number;
    action: ComponentAction;
  }): Promise<{ instance: ComponentInstance; event: ComponentEvent }>;
  updateInstance(input: {
    instanceId: string;
    expectedRevision: number;
    state: ComponentState;
  }): Promise<ComponentInstance>;
  markDispatched(input: { instanceId: string; eventId: string }): Promise<ComponentInstance>;
}

export type PublishComponentInput = {
  expectedRevision: number;
  componentId: string;
  version?: number;
  agentId?: string;
  state?: ComponentState;
};
export type TriggerComponentInput = {
  componentId: string;
  version?: number;
  triggerId: string;
  agentId: string;
  state?: ComponentState;
  occurrenceKey?: string;
};
export type InteractComponentInput = { instanceId: string; expectedRevision: number; action: ComponentAction };
export type ComponentInteractionResult = {
  instance: ComponentInstance;
  event: ComponentEvent;
  delivery: "state-only" | "queued" | "dispatched" | "unavailable";
  error?: string;
};
export type ComponentDrainResult = {
  dispatched: string[];
  queued: string[];
  errors: { agentId: string; message: string }[];
};
type Paseo = PluginHandlerContext["paseo"];
type Agent = ReturnType<Paseo["agents"]["ref"]>;
const triggerInputSchema = z
  .object({
    componentId: componentIdSchema,
    version: z.number().int().positive().optional(),
    triggerId: componentIdSchema,
    agentId: z.string().min(1).max(200),
    state: componentStateSchema.optional(),
    occurrenceKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const emptyDrain = (): ComponentDrainResult => ({ dispatched: [], queued: [], errors: [] });

export class ComponentController {
  private paseo: Paseo | null = null;
  private closed = false;
  private readonly draining = new Map<string, Promise<ComponentDrainResult>>();
  private readonly publishing = new Map<string, Promise<void>>();
  constructor(
    readonly service: ComponentControllerService,
    private readonly studio: Pick<StudioStore, "read">,
  ) {}

  bind(paseo: Paseo): void {
    if (this.closed) throw new Error("The component controller has stopped.");
    this.paseo = paseo;
  }

  bindContext(context: Pick<PluginHandlerContext, "paseo">): void {
    this.bind(context.paseo);
  }

  private requirePaseo(): Paseo {
    if (this.closed) throw new Error("The component controller has stopped.");
    if (!this.paseo) throw new Error("Open Theme Studio to connect components to the native Paseo agent.");
    return this.paseo;
  }

  async publish(input: PublishComponentInput): Promise<{ library: ComponentLibrary; instance: ComponentInstance }> {
    const paseo = this.requirePaseo();
    const library = await this.service.read();
    const definitions = library.definitions.filter(
      definition =>
        definition.id === input.componentId && (input.version === undefined || definition.version === input.version),
    );
    const definition = definitions.sort((a, b) => b.version - a.version)[0];
    if (!definition) throw new Error("The requested component version was not found.");
    if (definition.mode === "code" && !library.activeKeys.includes(`${definition.id}@${definition.version}`))
      throw new Error("Build and load this code component version before publishing it in a native conversation.");
    const agentId = input.agentId ?? (await this.studio.read()).designerAgentId;
    if (!agentId)
      throw new Error("Choose an owner agent or start the Theme Studio designer before publishing a component.");
    const agent = paseo.agents.ref(agentId);
    const refreshed = await agent.refresh();
    if (!refreshed) throw new Error("The component owner agent was not found.");
    if (agent.archivedAt) throw new Error("The component owner agent is archived. Choose an available agent.");
    if (refreshed.agent.providerUnavailable) throw new Error("The component owner agent's provider is unavailable.");
    const created = await this.service.createInstance({
      ...input,
      version: definition.version,
      agentId,
      ...(input.state ? { state: componentStateSchema.parse(input.state) } : {}),
    });
    const data = componentTimelineSchema.parse({
      instanceId: created.instance.id,
      componentId: created.instance.componentId,
      componentVersion: created.instance.componentVersion,
    });
    await agent.timeline.append({
      type: "plugin",
      id: created.instance.id,
      kind: "studio-component",
      version: 1,
      data,
    });
    return created;
  }

  async trigger(input: TriggerComponentInput): Promise<{ instance: ComponentInstance; reused: boolean }> {
    const value = triggerInputSchema.parse(input);
    const agent = this.requirePaseo().agents.ref(value.agentId);
    const refreshed = await agent.refresh();
    if (!refreshed) throw new Error("The component owner agent was not found.");
    if (
      agent.archivedAt ||
      refreshed.agent.providerUnavailable ||
      agent.status === "error" ||
      agent.status === "closed"
    )
      throw new Error("The trigger owner agent is unavailable.");
    const activeTurn = agent.activeTurn;
    const turnId = activeTurn?.turnId;
    if (!turnId) throw new Error("A component trigger requires its owner's active Paseo turn.");
    const turnStartedAt = activeTurn.startedAt;
    if (!turnStartedAt)
      throw new Error(
        "The active Paseo turn's start time is unavailable. Retry the trigger when its native turn context is available.",
      );
    const lastUser = await this.latestNativeUser(agent, value.agentId);
    if (lastUser?.item.type === "user_message" && (!lastUser.turnId || lastUser.turnId === turnId)) {
      const userMessage = lastUser.item;
      const messageId = userMessage.clientMessageId ?? userMessage.messageId;
      const library = await this.service.read();
      const callback = library.instances
        .filter(instance => instance.agentId === value.agentId && instance.componentId === value.componentId)
        .some(instance =>
          instance.events.some(
            event =>
              event.action.action !== "__state__" &&
              event.id === messageId &&
              componentEventPrompt(instance, event) === userMessage.text,
          ),
        );
      if (callback)
        throw new Error(
          "Automatic triggers are skipped while handling a component interaction. Update the existing instance instead.",
        );
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.closed) throw new Error("The component controller has stopped.");
      const library = await this.service.read();
      const definition = library.definitions
        .filter(
          item => item.id === value.componentId && (value.version === undefined || item.version === value.version),
        )
        .sort((a, b) => b.version - a.version)[0];
      if (!definition) throw new Error("The requested component version was not found.");
      const trigger = definition.triggers.find(item => item.id === value.triggerId && item.enabled);
      if (!trigger) throw new Error("The requested trigger is not enabled on this component version.");
      if (definition.mode === "code" && !library.activeKeys.includes(`${definition.id}@${definition.version}`))
        throw new Error("Build and load this code component version before triggering it in a native conversation.");
      let created: Awaited<ReturnType<ComponentControllerService["createInstance"]>>;
      try {
        created = await this.service.createInstance({
          expectedRevision: library.revision,
          componentId: definition.id,
          version: definition.version,
          agentId: value.agentId,
          ...(value.state ? { state: value.state } : {}),
          trigger: {
            id: trigger.id,
            event: trigger.event,
            turnId,
            turnStartedAt,
            occurrenceKey: value.occurrenceKey ?? "default",
          },
        });
      } catch (error) {
        if (error instanceof ComponentRevisionConflict && attempt < 4) continue;
        throw error;
      }
      await this.ensureTriggeredRow(agent, created.instance, Boolean(created.reused));
      return { instance: created.instance, reused: Boolean(created.reused) };
    }
    throw new Error("The component library kept changing. Retry the trigger shortly.");
  }

  private async latestNativeUser(agent: Agent, agentId: string) {
    let cursor: { epoch: string; seq: number } | undefined;
    for (let page = 0; page < 100; page++) {
      const timeline = await agent.timeline.refetch({
        projection: "canonical",
        direction: cursor ? "before" : "tail",
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      if (timeline.error || timeline.staleCursor || timeline.agentId !== agentId)
        throw new Error("The trigger's native conversation could not be verified.");
      const user = timeline.entries.findLast(entry => entry.item.type === "user_message");
      if (user) return user;
      if (!timeline.hasOlder) return undefined;
      if (
        !timeline.startCursor ||
        (cursor && timeline.startCursor.epoch === cursor.epoch && timeline.startCursor.seq >= cursor.seq) ||
        page === 99
      )
        throw new Error("The trigger's native conversation could not be fully checked. Retry shortly.");
      cursor = timeline.startCursor;
    }
    throw new Error("The trigger's native conversation could not be fully checked. Retry shortly.");
  }

  private ensureTriggeredRow(agent: Agent, instance: ComponentInstance, reused: boolean): Promise<void> {
    const pending = this.publishing.get(instance.id);
    if (pending) return pending;
    const operation = this.appendTriggeredRow(agent, instance, reused);
    this.publishing.set(instance.id, operation);
    void operation
      .finally(() => {
        if (this.publishing.get(instance.id) === operation) this.publishing.delete(instance.id);
      })
      .catch(() => {});
    return operation;
  }

  private async appendTriggeredRow(agent: Agent, instance: ComponentInstance, reused: boolean): Promise<void> {
    if (reused) {
      let cursor: { epoch: string; seq: number } | undefined;
      for (let page = 0; page < 100; page++) {
        const timeline = await agent.timeline.refetch({
          projection: "canonical",
          direction: cursor ? "before" : "tail",
          ...(cursor ? { cursor } : {}),
          limit: 100,
        });
        if (timeline.error || timeline.staleCursor || timeline.agentId !== instance.agentId)
          throw new Error(
            "The existing component publication could not be verified. Retry without creating another instance.",
          );
        if (
          timeline.entries.some(({ item }) => {
            if (
              item.type !== "plugin" ||
              item.pluginId !== "theme-studio" ||
              item.kind !== "studio-component" ||
              item.version !== 1
            )
              return false;
            const pointer = componentTimelineSchema.safeParse(item.data);
            return (
              pointer.success &&
              pointer.data.instanceId === instance.id &&
              pointer.data.componentId === instance.componentId &&
              pointer.data.componentVersion === instance.componentVersion
            );
          })
        )
          return;
        if (!timeline.hasOlder) break;
        if (
          !timeline.startCursor ||
          (cursor && timeline.startCursor.epoch === cursor.epoch && timeline.startCursor.seq >= cursor.seq) ||
          page === 99
        )
          throw new Error("The existing component publication could not be fully checked. Retry shortly.");
        cursor = timeline.startCursor;
      }
    }
    if (this.closed) throw new Error("The component controller has stopped.");
    const data = componentTimelineSchema.parse({
      instanceId: instance.id,
      componentId: instance.componentId,
      componentVersion: instance.componentVersion,
    });
    await agent.timeline.append({ type: "plugin", id: instance.id, kind: "studio-component", version: 1, data });
  }

  async interact(input: InteractComponentInput): Promise<ComponentInteractionResult> {
    const action = componentActionSchema.parse(input.action);
    const created = await this.service.interact({ ...input, action });
    if (action.action === "__state__") {
      const instance = await this.service.markDispatched({
        instanceId: created.instance.id,
        eventId: created.event.id,
      });
      return {
        instance,
        event: instance.events.find(event => event.id === created.event.id) ?? created.event,
        delivery: "state-only",
      };
    }
    const delivery = await this.drain(created.instance.agentId);
    const instance = await this.service.readInstance(created.instance.id);
    const event = instance.events.find(value => value.id === created.event.id) ?? created.event;
    const error = delivery.errors.find(value => value.agentId === instance.agentId)?.message;
    return {
      instance,
      event,
      delivery: event.dispatchedAt ? "dispatched" : error ? "unavailable" : "queued",
      ...(error ? { error } : {}),
    };
  }

  updateState(input: {
    instanceId: string;
    expectedRevision: number;
    state: ComponentState;
  }): Promise<ComponentInstance> {
    return this.service.updateInstance({ ...input, state: componentStateSchema.parse(input.state) });
  }

  async listInstance(instanceId: string): Promise<{ instance: ComponentInstance; definition: ComponentDefinition }> {
    const instance = await this.service.readInstance(instanceId);
    const library = await this.service.read();
    const definition = library.definitions.find(
      value => value.id === instance.componentId && value.version === instance.componentVersion,
    );
    if (!definition) throw new Error("The component instance's version was not found.");
    return { instance, definition };
  }

  async drain(agentId?: string): Promise<ComponentDrainResult> {
    if (this.closed) return emptyDrain();
    const library = await this.service.read();
    const owners = agentId
      ? [agentId]
      : [
          ...new Set(
            library.instances
              .filter(instance =>
                instance.events.some(event => !event.dispatchedAt && event.action.action !== "__state__"),
              )
              .map(instance => instance.agentId),
          ),
        ];
    const results = await Promise.all(owners.map(owner => this.drainOwner(owner)));
    return {
      dispatched: results.flatMap(result => result.dispatched),
      queued: results.flatMap(result => result.queued),
      errors: results.flatMap(result => result.errors),
    };
  }

  private drainOwner(agentId: string): Promise<ComponentDrainResult> {
    const pending = this.draining.get(agentId);
    if (pending) return pending;
    const operation = this.dispatchOne(agentId);
    this.draining.set(agentId, operation);
    void operation
      .finally(() => {
        if (this.draining.get(agentId) === operation) this.draining.delete(agentId);
      })
      .catch(() => {});
    return operation;
  }

  private async dispatchOne(agentId: string): Promise<ComponentDrainResult> {
    const result = emptyDrain();
    const library = await this.service.read();
    const pending = library.instances
      .filter(instance => instance.agentId === agentId)
      .flatMap(instance =>
        instance.events
          .filter(event => !event.dispatchedAt && event.action.action !== "__state__")
          .map(event => ({ instance, event })),
      )
      .sort((a, b) => a.event.at.localeCompare(b.event.at));
    result.queued = pending.map(value => value.event.id);
    if (!pending.length || this.closed) return result;
    try {
      const paseo = this.requirePaseo();
      const agent = paseo.agents.ref(agentId);
      const refreshed = await agent.refresh();
      if (!refreshed) throw new Error("The component owner agent was not found. The interaction remains queued.");
      if (agent.archivedAt) throw new Error("The component owner agent is archived. The interaction remains queued.");
      if (refreshed.agent.providerUnavailable)
        throw new Error("The component owner agent's provider is unavailable. The interaction remains queued.");
      if (agent.status === "error" || agent.status === "closed")
        throw new Error(
          "The component owner agent is unavailable. Open its native chat to recover it; the interaction remains queued.",
        );
      const permissionAttention = refreshed.agent.requiresAttention && refreshed.agent.attentionReason !== "finished";
      if (
        agent.status !== "idle" ||
        agent.activeTurn ||
        (agent.pendingPermissions?.length ?? 0) > 0 ||
        permissionAttention ||
        this.closed
      )
        return result;
      const { instance, event } = pending[0];
      await agent.send(componentEventPrompt(instance, event), { messageId: event.id });
      await this.service.markDispatched({ instanceId: instance.id, eventId: event.id });
      result.dispatched.push(event.id);
      result.queued = result.queued.filter(id => id !== event.id);
    } catch (error) {
      result.errors.push({
        agentId,
        message:
          error instanceof Error
            ? error.message
            : "The component interaction could not reach its owner agent. It remains queued.",
      });
    }
    return result;
  }

  /** Reports whether Paseo still knows an agent. "unknown" never justifies deleting data. */
  async agentPresence(agentId: string): Promise<"present" | "missing" | "unknown"> {
    if (this.closed || !this.paseo) return "unknown";
    try {
      return (await this.paseo.agents.ref(agentId).refresh()) ? "present" : "missing";
    } catch (error) {
      // Paseo 0.9.2 throws this exact message for an unknown agent.
      return error instanceof Error && error.message === `Agent not found: ${agentId}` ? "missing" : "unknown";
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.draining.values(), ...this.publishing.values()]);
    this.paseo = null;
  }
}
