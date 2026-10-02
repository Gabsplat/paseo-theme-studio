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
