// Defaults for a new designer session. The Model control in Theme Studio overrides them.
export const defaultDesignerProvider = "codex";
export function defaultDesignerModel(provider: string): string {
  if (provider === "codex") return "gpt-6.1-sol";
  if (provider === "opencode") return "opencode/claude-sonnet-4-6";
  return "default";
}
