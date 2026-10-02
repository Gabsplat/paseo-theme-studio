import assert from "node:assert/strict";
import test from "node:test";
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { forestTheme, type StudioTheme } from "../shared/theme";
import { packToolCardSchema, transformPackTool } from "./pack-transform";

type ToolInput = Parameters<PluginTimelineTransformerContribution<"tool_call">["transform"]>[0];
type ToolItem = ToolInput["item"];
const pack: StudioTheme = { ...forestTheme, ui: { ...forestTheme.ui, toolCards: "bordered" } };
const shell: ToolItem = { type: "tool_call", callId: "call-check-01", name: "exec_command", status: "completed", error: null, detail: { type: "shell", command: "npm run check\n# no execution by renderer", cwd: "/projects/site with spaces", output: "✓ tests passed\nUnicode output: 你好 🌲\n$ literal $(not-executed)\n", exitCode: 0 } };
const input = (item: ToolItem, phase: ToolInput["phase"] = "complete"): ToolInput => ({ item, phase });

test("completed shell retains every command/output field and stable identity without changing its source", () => {
  const snapshot = JSON.stringify(shell);
  const result = transformPackTool(pack, input(shell));
  assert.equal(result?.items.length, 1);
  const replacement = result!.items[0];
  assert.equal(replacement.id, shell.callId);
  assert.equal(replacement.kind, "theme-pack-tool");
  assert.equal(replacement.version, 1);
  assert.deepEqual(packToolCardSchema.parse(replacement.data), { label: "exec_command", kind: "shell", command: shell.detail.type === "shell" ? shell.detail.command : "", cwd: "/projects/site with spaces", output: "✓ tests passed\nUnicode output: 你好 🌲\n$ literal $(not-executed)\n", exitCode: 0 });
  assert.equal(JSON.stringify(shell), snapshot);
  assert.deepEqual(transformPackTool(pack, input(shell)), result);
});

test("completed plain text retains label and full text and falls back to the native tool name", () => {
  const text: ToolItem = { type: "tool_call", callId: "call-note-02", name: "check", status: "completed", error: null, detail: { type: "plain_text", label: "Validation", text: "First line\nSecond line\n" } };
  assert.deepEqual(transformPackTool(pack, input(text))?.items[0].data, { label: "Validation", kind: "plain_text", output: "First line\nSecond line\n" });
  const unlabeled: ToolItem = { ...text, detail: { type: "plain_text", text: "Complete" } };
  assert.deepEqual(transformPackTool(pack, input(unlabeled))?.items[0].data, { label: "check", kind: "plain_text", output: "Complete" });
});

test("native or inactive packs and all streaming/running/failed/canceled tools keep native rows", () => {
  assert.equal(transformPackTool(forestTheme, input(shell)), undefined);
  assert.equal(transformPackTool(null, input(shell)), undefined);
  assert.equal(transformPackTool(pack, input(shell, "streaming")), undefined);
  const running: ToolItem = { ...shell, status: "running", error: null };
  const failed: ToolItem = { ...shell, status: "failed", error: { message: "permission denied" } };
  const canceled: ToolItem = { ...shell, status: "canceled", error: null };
  for (const item of [running, failed, canceled]) assert.equal(transformPackTool(pack, input(item)), undefined);
  const failedCommand: ToolItem = { ...failed, detail: { type: "shell", command: "npm test", output: "Tests failed", exitCode: 1 } };
  assert.equal(transformPackTool(pack, input(failedCommand)), undefined);
  const completedNonzero: ToolItem = { ...shell, detail: { type: "shell", command: "npm test", output: "Tests failed", exitCode: 1 } };
  assert.equal(transformPackTool(pack, input(completedNonzero)), undefined);
});

test("file, search, navigation, worktree, and subagent tools keep their native actions", () => {
  const details: ToolItem["detail"][] = [
    { type: "read", filePath: "/projects/site/app.tsx", content: "source" },
    { type: "edit", filePath: "app.tsx", oldString: "old", newString: "new", unifiedDiff: "-old\n+new" },
    { type: "write", filePath: "app.tsx", content: "new source" },
    { type: "search", query: "navigation", filePaths: ["app.tsx"] },
    { type: "fetch", url: "https://example.com", result: "response" },
    { type: "sub_agent", childSessionId: "child-1", log: "done" },
    { type: "worktree_setup", worktreePath: "/worktree", branchName: "dev", log: "ready", commands: [], truncated: false },
    { type: "plan", text: "Review app" },
    { type: "unknown", input: { permission: true }, output: { actions: ["approve"] } },
  ];
  for (const detail of details) assert.equal(transformPackTool(pack, input({ ...shell, detail })), undefined, detail.type);
});

test("oversized commands and output stay native rather than losing content", () => {
  const oversized: ToolItem = { ...shell, detail: { type: "shell", command: "npm run check", output: "🌲".repeat(15000), exitCode: 0 } };
  const snapshot = JSON.stringify(oversized);
  assert.equal(transformPackTool(pack, input(oversized)), undefined);
  assert.equal(JSON.stringify(oversized), snapshot);
  const oversizedCommand: ToolItem = { ...shell, detail: { type: "shell", command: "x".repeat(15000), output: "", exitCode: 0 } };
  assert.equal(transformPackTool(pack, input(oversizedCommand)), undefined);
});
