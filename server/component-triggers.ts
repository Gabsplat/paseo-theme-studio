import type { ComponentLibrary } from "../shared/components";

// Discovery exposes the latest rules, without loading code or conversation state.
/**
 * Connected agents read this catalog at the start of every request, so it is the one
 * place that reaches agents created before show_live existed, without a reload.
 */
export const liveFrameRule = {
  tool: "show_live",
  when: "The answer explains something that is easier to see or try than to read: a chart or graph (including explaining what a type of chart is), a diagram of how something works, a comparison, a timeline, a calculator, a simulator, or a small tool. Show it with show_live in this turn, then keep the text short and refer to the frame. Skip it for plain facts, code edits, or one-line answers.",
} as const;

export function componentTriggerCatalog(library: ComponentLibrary, automaticTriggers: boolean) {
  const latest = new Map<string, ComponentLibrary["definitions"][number]>();
  for (const definition of library.definitions) {
    if (!latest.has(definition.id) || latest.get(definition.id)!.version < definition.version)
      latest.set(definition.id, definition);
  }
  return {
    automaticTriggers,
    liveFrames: liveFrameRule,
    components: [...latest.values()]
      // Retired block compositions are never offered to agents.
      .filter(definition => definition.mode === "code" && definition.triggers.some(trigger => trigger.enabled))
      .map(definition => ({
        componentId: definition.id,
        version: definition.version,
        name: definition.name,
        mode: definition.mode,
        available: library.activeKeys.includes(`${definition.id}@${definition.version}`),
        triggers: definition.triggers.filter(trigger => trigger.enabled),
      })),
  };
}
