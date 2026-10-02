import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { componentEventPrompt } from "../shared/component-event";
import type { ComponentInstance, ComponentLibrary, ComponentState } from "../shared/components";

type UserMessage = Parameters<PluginTimelineTransformerContribution<"user_message">["transform"]>[0]["item"];
const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Compare JSON values without depending on property insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

/** Only persisted, uniquely owned event IDs can suppress a native message. */
export class ComponentEventIndex {
  private instances = new Map<string, ComponentInstance>();
  private instanceSignatures = new Map<string, string>();
  private messages = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  private signature = "";

  updateLibrary(library: ComponentLibrary) {
    let changed = false;
    for (const instance of library.instances) changed = this.remember(instance) || changed;
    if (changed) this.rebuild();
  }

  updateInstance(instance: ComponentInstance) {
    if (this.remember(instance)) this.rebuild();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private remember(instance: ComponentInstance) {
    const previous = this.instances.get(instance.id);
    if (previous && instance.revision < previous.revision) return false;
    const signature = JSON.stringify({ agentId: instance.agentId, componentId: instance.componentId, version: instance.componentVersion, events: instance.events.map(({ dispatchedAt: _delivery, ...event }) => event) });
    const changed = signature !== this.instanceSignatures.get(instance.id);
    this.instances.set(instance.id, instance);
    this.instanceSignatures.set(instance.id, signature);
    return changed;
  }

  private rebuild() {
    const candidates = new Map<string, { count: number; payloads: Set<string> }>();
    for (const instance of this.instances.values()) for (const event of instance.events) {
      if (event.action.action === "__state__" || !eventIdPattern.test(event.id)) continue;
      const entry = candidates.get(event.id) ?? { count: 0, payloads: new Set<string>() };
      entry.count++;
      const payload = JSON.parse(componentEventPrompt(instance, event).split("\n").at(-1)!);
      entry.payloads.add(canonical(payload));
      // Earlier plugin versions sent the same immutable event payload without
      // agentId. Native message identity still verifies the unique owner.
      const { agentId: _owner, ...legacy } = payload;
      entry.payloads.add(canonical(legacy));
      candidates.set(event.id, entry);
    }
    const messages = new Map([...candidates].filter(([, entry]) => entry.count === 1).map(([id, entry]) => [id, entry.payloads]));
    const signature = canonical([...messages].sort(([a], [b]) => a.localeCompare(b)).map(([id, payloads]) => [id, [...payloads].sort()]));
    this.messages = messages;
    if (signature === this.signature) return;
    this.signature = signature;
    for (const listener of this.listeners) listener();
  }

  hides(item: UserMessage): boolean {
    const id = item.clientMessageId ?? item.messageId;
    if (!id) return false;
    const expected = this.messages.get(id);
    if (!expected) return false;
    try {
      // No prefix or regex decides visibility: the complete immutable payload
      // and native message identity must both match the persisted event.
      return expected.has(canonical(JSON.parse(item.text.trim().split("\n").at(-1)!)));
    } catch { return false; }
  }
}

export function componentHasAgentUpdate(instance: ComponentInstance): boolean {
  const index = instance.events.findLastIndex(event => event.action.action !== "__state__");
  if (index < 0) return false;
  let expected: ComponentState = { ...instance.events[index].state };
  for (const event of instance.events.slice(index + 1)) expected = { ...expected, ...event.action.patch };
  return canonical(instance.state) !== canonical(expected);
}

export const componentEvents = new ComponentEventIndex();
