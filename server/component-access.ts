import type { ComponentLibrary } from "../shared/components";

export const customOnlyMessage =
  "Theme Studio only uses custom components. Write this one with create_code_component; pre-made block compositions are retired.";

/**
 * Components are always written for the task by an agent. Block compositions from
 * earlier versions stay readable so their old chat rows keep rendering, but they can
 * no longer be created, published, or triggered.
 */
export function assertCustomComponent(
  library: Pick<ComponentLibrary, "definitions">,
  componentId: string,
  version?: number,
): void {
  const definition = library.definitions
    .filter(item => item.id === componentId && (version === undefined || item.version === version))
    .sort((a, b) => b.version - a.version)[0];
  if (definition && definition.mode !== "code") throw new Error(customOnlyMessage);
}

// Agents share one bridge endpoint, so the bridge reports which agent is calling.
// Without this check any connected agent could place a card, and through its state
// a prompt, in another agent's conversation.
export function assertComponentTarget(
  caller: string | undefined,
  target: string,
  designerAgentId: string | null | undefined,
): void {
  if (!caller)
    throw new Error(
      "Theme Studio could not verify which agent is calling. Reload this agent to refresh its Theme Studio tools.",
    );
  if (caller === target) return;
  // The dedicated designer acts for the user across conversations.
  if (designerAgentId && caller === designerAgentId) return;
  throw new Error("Agents can only publish or update components in their own conversation.");
}
