import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { ThemeBridge } from "./bridge";
import { Designer } from "./designer";
import { StudioStore } from "./store";

test("designer replaces a reserved orphan ID while preserving its workspace and unrelated refresh errors", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-designer-test-"));
  const store = new StudioStore(directory);
  const bridge = new ThemeBridge(store);
  let designer = new Designer(store, bridge);
  t.after(async () => { await designer.close(); await bridge.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const agents = new Map<string, { id: string; workspaceId: string; archivedAt: null }>();
  const creations: Array<{ agentId: string; prompt?: string; config: { provider: string; thinkingOptionId?: string; systemPrompt: string; mcpServers: Record<string, { args: string[] }> } }> = [];
  let workspaceCreations = 0;
  let failCreate = true;
  let refreshFailure: Error | null = null;
  const reserved = new Set<string>();
  const workspace = {
    id: "workspace-1", directory: join(directory, "designer-workspace"),
    refresh: async () => ({ archivingAt: null }),
    agents: { create: async (options: any) => {
      creations.push(options);
      if (reserved.has(options.agentId)) throw new Error("agent_id_conflict");
      reserved.add(options.agentId);
      if (failCreate) { failCreate = false; throw new Error("temporary provider failure"); }
      const agent = { id: options.agentId, workspaceId: "workspace-1", archivedAt: null };
      agents.set(agent.id, agent);
      return agent;
    } },
  };
  const paseo = {
    agents: { ref: (id: string) => ({ id, get workspaceId() { return agents.get(id)?.workspaceId ?? null; }, get archivedAt() { return agents.get(id)?.archivedAt ?? null; }, refresh: async () => {
      if (refreshFailure) throw refreshFailure;
      if (!agents.has(id)) throw new Error(`Agent not found: ${id}`);
      return { agent: agents.get(id) };
    } }) },
    workspaces: { ref: () => workspace, create: async () => { workspaceCreations++; return workspace; } },
  } as unknown as PluginHandlerContext["paseo"];
  await assert.rejects(designer.start({}, paseo), /temporary provider failure/);
  const reservedId = creations[0].agentId;
  designer = new Designer(store, bridge);
  for (const error of [new Error("Daemon connection closed"), new Error("Agent not found: another-agent")]) {
    refreshFailure = error;
    await assert.rejects(designer.start({}, paseo), caught => caught === error);
    assert.equal(creations.length, 1);
    assert.equal(workspaceCreations, 1);
    assert.equal((await store.read()).designerAgentId, null);
  }
  refreshFailure = null;
  const [first, concurrent] = await Promise.all([designer.start({}, paseo), designer.start({}, paseo)]);
  assert.deepEqual(first, concurrent);
  assert.notEqual(first.agentId, reservedId);
  assert.equal(first.workspaceId, "workspace-1");
  assert.equal(workspaceCreations, 1);
  assert.equal(creations.length, 2);
  assert.equal(creations[1].prompt, undefined);
  assert.equal(creations[1].config.provider, "codex/gpt-6.1-sol");
  assert.equal(creations[1].config.thinkingOptionId, "high");
  assert.match(creations[1].config.systemPrompt, /Never overwrite a locked color/);
  const args=creations[1].config.mcpServers["theme-studio"].args;
  assert.deepEqual(args.slice(0,2), [bridge.script, bridge.endpoint]);
  assert.equal(args.length,3);
  assert.deepEqual(JSON.parse(await readFile(args[2],"utf8")),{agentId:first.agentId});
  assert.notEqual(args[2],creations[0].config.mcpServers["theme-studio"].args[2]);
  assert.match(creations[1].config.systemPrompt,new RegExp(first.agentId));
  const remembered = await store.read();
  assert.equal(remembered.designerAgentId, first.agentId);
  designer = new Designer(new StudioStore(directory), bridge);
  assert.deepEqual(await designer.start({}, paseo), first);
  assert.equal(creations.length, 2);
  assert.equal((await store.read()).revision, remembered.revision);
});
