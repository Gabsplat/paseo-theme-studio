import type { ComponentLibrary } from "../shared/components";

// Discovery exposes the latest rules, without loading code or conversation state.
export function componentTriggerCatalog(library: ComponentLibrary, automaticTriggers: boolean) {
  const latest = new Map<string, ComponentLibrary["definitions"][number]>();
  for (const definition of library.definitions) {
    if (!latest.has(definition.id) || latest.get(definition.id)!.version < definition.version)
      latest.set(definition.id, definition);
  }
  return {
    automaticTriggers,
    components: [...latest.values()]
      .filter(definition => definition.triggers.some(trigger => trigger.enabled))
      .map(definition => ({
        componentId: definition.id,
        version: definition.version,
        name: definition.name,
        mode: definition.mode,
        available:
          definition.mode === "composition" || library.activeKeys.includes(`${definition.id}@${definition.version}`),
        triggers: definition.triggers.filter(trigger => trigger.enabled),
      })),
  };
}
