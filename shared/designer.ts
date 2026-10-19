// Defaults for a new designer session. The Model control in Theme Studio overrides them.
export const defaultDesignerProvider = "codex";
// Model names change with providers and accounts (Codex stopped serving gpt-6.1-sol to ChatGPT
// accounts), so Codex and Claude Code use whatever the provider reports as its default.
export function defaultDesignerModel(provider: string): string {
  if (provider === "opencode") return "opencode/claude-sonnet-4-6";
  return "default";
}
