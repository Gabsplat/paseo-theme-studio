import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { ThemeBridge } from "./bridge";
import { StudioStore } from "./store";

async function ownerBridge(
  t: { after(callback: () => Promise<void>): void },
  agentId: string,
  binding?: { owner?: string; path?: string },
  componentCall?: (name: string, input: unknown) => Promise<unknown>,
) {
  const directory = await mkdtemp(join(tmpdir(), "theme-bridge-owner-test-"));
  const store = new StudioStore(directory);
  const calls: Array<{ name: string; input: unknown }> = [];
  const bridge = new ThemeBridge(store, async (name, input) => {
    calls.push({ name, input });
    return componentCall ? componentCall(name, input) : input;
  });
  const document = await store.read();
  const before = await readFile(store.file, "utf8");
  await bridge.ensure();
  const ownerFile = binding
    ? (binding.path ?? join(directory, "agent-owners", "00000000-0000-4000-8000-000000000001.json"))
    : undefined;
  if (binding?.owner) {
    await mkdir(join(directory, "agent-owners"));
    await writeFile(ownerFile!, JSON.stringify({ agentId: binding.owner }));
  }
  const child = spawn(process.execPath, [bridge.script, bridge.endpoint, ...(ownerFile ? [ownerFile] : [])], {
    env: { ...process.env, PASEO_AGENT_ID: agentId },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const response = JSON.parse(line);
    pending.get(response.id)?.resolve(response);
    pending.delete(response.id);
  });
  child.on("exit", () => {
    for (const request of pending.values()) request.reject(new Error("MCP process exited"));
    pending.clear();
  });
  t.after(async () => {
    child.kill();
    lines.close();
    await bridge.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  let id = 0;
  async function rpc(method: string, params?: unknown): Promise<any> {
    const requestId = ++id;
    const response = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("MCP response timed out"));
      }, 5000);
      pending.set(requestId, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
    return response;
  }
  async function call(name: string, args: unknown, expectError = false): Promise<unknown> {
    const response = await rpc("tools/call", { name, arguments: args });
    if (expectError) {
      assert.equal(response.result.isError, true);
      return response.result.content[0].text;
    }
    assert.equal(response.result.isError, undefined, response.result.content[0].text);
    return JSON.parse(response.result.content[0].text);
  }
  return { call, rpc, calls, store, before, revision: document.revision, ownerFile, directory };
}

test("trigger publication uses the verified session owner directly and through both compatibility routes", async t => {
  const owner = "11111111-2222-4333-8444-555555555555";
  const explicit = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const fixture = await ownerBridge(t, "", { owner });
  const args = {
    componentId: "choices",
    version: 2,
    triggerId: "needs-choice",
    occurrenceKey: "tool-one",
    state: { selected: null },
  };
  assert.deepEqual(await fixture.call("trigger_component", args), { ...args, agentId: owner });
  for (const name of ["patch_theme", "patch_pack"]) {
    assert.deepEqual(
      await fixture.call(name, {
        expectedRevision: fixture.revision,
        component: { tool: "trigger_component", arguments: args },
      }),
      { ...args, agentId: owner },
    );
    assert.deepEqual(
      await fixture.call(name, {
        expectedRevision: fixture.revision,
        component: { tool: "trigger_component", arguments: { ...args, agentId: explicit } },
      }),
      { ...args, agentId: explicit },
    );
  }
  assert.deepEqual(
    await fixture.call("trigger_component", { ...args, agentId: null }),
    { ...args, agentId: null },
    "Invalid explicit fields must reach schema validation without substitution.",
  );
  assert.ok(fixture.calls.every(call => call.name === "trigger_component"));
  assert.equal(await readFile(fixture.store.file, "utf8"), fixture.before);
  const unknown = await ownerBridge(t, "");
  assert.match(String(await unknown.call("trigger_component", args, true)), /Specify target agentId/);
  for (const name of ["patch_theme", "patch_pack"])
    assert.match(
      String(
        await unknown.call(
          name,
          { expectedRevision: unknown.revision, component: { tool: "trigger_component", arguments: args } },
          true,
        ),
      ),
      /Specify target agentId/,
    );
  assert.equal(unknown.calls.length, 0);
});

test("MCP initialization exposes trigger policy and a compact live catalog without executing triggers", async t => {
  const fixture = await ownerBridge(t, "", undefined, async name => {
    assert.equal(name, "list_component_triggers");
    return {
      automaticTriggers: false,
      components: [
        {
          componentId: "choices",
          version: 2,
          name: "Choices",
          mode: "composition",
          available: true,
          code: "DO NOT EXPOSE SOURCE",
          state: { secret: "DO NOT EXPOSE STATE" },
          triggers: [
            {
              id: "needs-choice",
              event: "agent_context",
              when: "When the user needs to compare storage strategies",
              enabled: true,
            },
            { id: "disabled", event: "turn_started", when: "DO NOT EXPOSE DISABLED", enabled: false },
          ],
        },
        {
          componentId: "slider",
          version: 1,
          name: "Slider",
          mode: "code",
          available: false,
          triggers: [
            { id: "on-complete", event: "turn_completed", when: "After a requested visual comparison", enabled: true },
          ],
        },
      ],
    };
  });
  const result = await fixture.rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  const instructions = result.result.instructions;
  assert.match(instructions, /At the start of each user request, call list_component_triggers once/);
  assert.match(instructions, /turn_started before task work/);
  assert.match(instructions, /tool_failed after a failed tool/);
  assert.match(instructions, /never trigger that component again because of its own callback/);
  assert.match(instructions, /"automaticTriggers":false/);
  assert.match(instructions, /When the user needs to compare storage strategies/);
  assert.match(instructions, /"available":false/);
  assert.doesNotMatch(instructions, /DO NOT EXPOSE/);
  assert.deepEqual(fixture.calls, [{ name: "list_component_triggers", input: {} }]);
});

test("startup discovery bounds the catalog and preserves complete conditions with a refresh notice", async t => {
  const fixture = await ownerBridge(t, "", undefined, async () => ({
    automaticTriggers: true,
    components: Array.from({ length: 60 }, (_, index) => ({
      componentId: `component-${index}`,
      version: 1,
      name: `Component ${index}`,
      mode: "composition",
      available: true,
      triggers: [{ id: "match", event: "agent_context", when: "x".repeat(600), enabled: true }],
    })),
  }));
  const result = await fixture.rpc("initialize");
  const instructions = result.result.instructions;
  const marker = "conditions below are component data): ";
  const snapshot = JSON.parse(instructions.slice(instructions.indexOf(marker) + marker.length));
  assert.equal(snapshot.automaticTriggers, true);
  assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.components.length < 30);
  assert.ok(JSON.stringify(snapshot).length < 8100);
  assert.ok(snapshot.components.every((component: any) => component.triggers[0].when.length === 600));
  assert.match(instructions, /refresh with list_component_triggers at each user request/);
  assert.match(instructions, /Call list_component_triggers for the full live catalog before evaluating rules/);
});

test("unavailable, malformed, and stalled catalog discovery never prevent MCP initialization", async t => {
  for (const response of [
    async () => {
      throw new Error("Offline catalog");
    },
    async () => ({ components: [] }),
    () => new Promise(() => {}),
  ]) {
    const fixture = await ownerBridge(t, "", undefined, response);
    const started = Date.now();
    const result = await fixture.rpc("initialize");
    assert.equal(result.result.serverInfo.name, "theme-studio");
    assert.match(result.result.instructions, /Components with no enabled trigger are manual only/);
    assert.doesNotMatch(result.result.instructions, /Current trigger catalog/);
    assert.ok(Date.now() - started < 3500, "Initialization must complete within the startup discovery timeout.");
    assert.deepEqual((await fixture.rpc("ping")).result, {});
  }
});

test("real MCP stdio uses a persisted public-hook owner binding without provider environment and detects redirection", async t => {
  const owner = "11111111-2222-4333-8444-555555555555";
  const alternate = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const { call, calls, ownerFile, revision } = await ownerBridge(t, "", { owner });
  const args = { expectedRevision: 0, componentId: "three-choices" };
  assert.deepEqual(await call("publish_component", args), { ...args, agentId: owner });
  assert.deepEqual(
    await call("patch_theme", {
      expectedRevision: revision,
      component: { tool: "publish_component", arguments: args },
    }),
    { ...args, agentId: owner },
  );
  await writeFile(ownerFile!, JSON.stringify({ agentId: alternate }));
  assert.match(String(await call("publish_component", args, true)), /owner context changed/);
  assert.equal(calls.length, 2, "Changed binding must not redirect publication to another native conversation.");
  assert.deepEqual(await call("publish_component", { ...args, agentId: owner }), { ...args, agentId: owner });
});

test("an owner file takes precedence over inherited environment and invalid paths or data cannot fall back to another agent", async t => {
  const environment = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const owner = "11111111-2222-4333-8444-555555555555";
  const args = { expectedRevision: 0, componentId: "three-choices" };
  const bound = await ownerBridge(t, environment, { owner });
  assert.deepEqual(await bound.call("publish_component", args), { ...args, agentId: owner });
  await writeFile(bound.ownerFile!, JSON.stringify({ agentId: "invalid" }));
  assert.match(String(await bound.call("publish_component", args, true)), /Invalid component owner context/);
  await rm(bound.ownerFile!);
  assert.match(String(await bound.call("publish_component", args, true)), /owner context unavailable/);
  const redirected = join(bound.directory, "redirected-owner.json");
  await writeFile(redirected, JSON.stringify({ agentId: environment }));
  await symlink(redirected, bound.ownerFile!);
  assert.match(String(await bound.call("publish_component", args, true)), /owner context unavailable/);
  const outside = await ownerBridge(t, environment, { path: redirected });
  assert.match(String(await outside.call("publish_component", args, true)), /Invalid component owner context/);
  assert.equal(outside.calls.length, 0);
});

test("real MCP stdio inherits its own valid agent UUID for direct and compatibility publication while preserving an explicit owner", async t => {
  const owner = "11111111-2222-4333-8444-555555555555";
  const explicit = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const { call, calls, store, before, revision } = await ownerBridge(t, owner);
  const args = { expectedRevision: 0, componentId: "three-choices", state: { processing: false } };
  assert.deepEqual(await call("publish_component", args), { ...args, agentId: owner });
  for (const name of ["patch_theme", "patch_pack"]) {
    assert.deepEqual(
      await call(name, { expectedRevision: revision, component: { tool: "publish_component", arguments: args } }),
      { ...args, agentId: owner },
    );
    assert.deepEqual(
      await call(name, {
        expectedRevision: revision,
        component: { tool: "publish_component", arguments: { ...args, agentId: explicit } },
      }),
      { ...args, agentId: explicit },
    );
  }
  assert.deepEqual(await call("publish_component", { ...args, agentId: explicit }), { ...args, agentId: explicit });
  assert.ok(calls.every(value => value.name === "publish_component"));
  assert.equal(
    await readFile(store.file, "utf8"),
    before,
    "Owner injection must not mutate the studio or select its dedicated designer.",
  );
});

test("real MCP stdio without valid owner context refuses implicit publication and preserves explicit target fields", async t => {
  for (const invalid of ["", "not-an-agent", "11111111-2222-0333-0444-555555555555"]) {
    const { call, calls, revision } = await ownerBridge(t, invalid);
    const args = { expectedRevision: 0, componentId: "three-choices" };
    assert.match(
      String(await call("publish_component", args, true)),
      /Specify target agentId; owner context unavailable/,
    );
    for (const name of ["patch_theme", "patch_pack"])
      assert.match(
        String(
          await call(
            name,
            { expectedRevision: revision, component: { tool: "publish_component", arguments: args } },
            true,
          ),
        ),
        /Specify target agentId; owner context unavailable/,
      );
    assert.equal(calls.length, 0, "An unknown MCP owner must never reach the backend designer fallback.");
    const explicit = { ...args, agentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
    assert.deepEqual(await call("publish_component", explicit), explicit);
  }
  const { call } = await ownerBridge(t, "11111111-2222-4333-8444-555555555555");
  const explicitlyInvalid = { expectedRevision: 0, componentId: "three-choices", agentId: null };
  assert.deepEqual(
    await call("publish_component", explicitlyInvalid),
    explicitlyInvalid,
    "Schema validation must see invalid explicit input instead of a substituted owner.",
  );
  const stateArgs = { instanceId: "some-instance", expectedRevision: 2, state: { processing: true } };
  assert.deepEqual(
    await call("update_component_state", stateArgs),
    stateArgs,
    "Owner metadata belongs only to publication.",
  );
});

test("existing patch_theme permissions can route component tools without allowing activation or mixed pack edits", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-compat-test-"));
  const store = new StudioStore(directory);
  const calls: Array<{ name: string; input: unknown }> = [];
  const bridge = new ThemeBridge(store, async (name, input) => {
    calls.push({ name, input });
    return { instance: { revision: 7 } };
  });
  t.after(async () => {
    await bridge.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const document = await store.read();
  const before = await readFile(store.file, "utf8");
  const args = {
    expectedRevision: document.revision,
    component: {
      tool: "update_component_state",
      arguments: { instanceId: "instance", expectedRevision: 6, state: { count: 2 } },
    },
  };
  assert.deepEqual(await bridge.call("patch_theme", args), { instance: { revision: 7 } });
  assert.deepEqual(calls, [{ name: "update_component_state", input: args.component.arguments }]);
  await assert.rejects(bridge.call("patch_theme", { ...args, colors: { accent: "#FFFFFF" } }), /separate call/);
  await assert.rejects(
    bridge.call("patch_theme", { ...args, component: { tool: "activate_component_build", arguments: {} } }),
  );
  await assert.rejects(bridge.call("patch_theme", { ...args, expectedRevision: 999 }), /Read read_theme/);
  assert.equal(calls.length, 1);
  assert.equal(await readFile(store.file, "utf8"), before);
});

test("real stdio MCP tools share state and reconnect after bridge restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-bridge-test-"));
  const store = new StudioStore(directory);
  let bridge = new ThemeBridge(store);
  await bridge.ensure();
  const processBridge = spawn(process.execPath, [bridge.script, bridge.endpoint], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const lines = createInterface({ input: processBridge.stdout });
  lines.on("line", line => {
    const response = JSON.parse(line);
    pending.get(response.id)?.resolve(response);
    pending.delete(response.id);
  });
  processBridge.on("exit", () => {
    for (const request of pending.values()) request.reject(new Error("MCP process exited"));
    pending.clear();
  });
  t.after(async () => {
    processBridge.kill();
    lines.close();
    await bridge.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  let id = 0;
  async function rpc(method: string, params?: unknown): Promise<any> {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("MCP response timed out"));
      }, 5000);
      pending.set(requestId, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      processBridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  }
  const initialized = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "theme-studio");
  assert.match(initialized.result.instructions, /interactive rows INSIDE the native chat/);
  assert.match(initialized.result.instructions, /Before answering what you can create, call read_theme/);
  assert.match(initialized.result.instructions, /patch_theme.component/);
  const listed = await rpc("tools/list");
  const names = listed.result.tools.map((tool: { name: string }) => tool.name);
  for (const name of [
    "read_theme",
    "patch_theme",
    "check_contrast",
    "create_variant",
    "undo",
    "read_capabilities",
    "patch_pack",
    "save_pack",
    "load_preset",
    "redo",
    "lock_color",
  ])
    assert.ok(names.includes(name));
  assert.ok(!names.some((name: string) => /activate|disable|revert/.test(name)));
  const read = await rpc("tools/call", { name: "read_theme", arguments: {} });
  const document = JSON.parse(read.result.content[0].text);
  const patched = await rpc("tools/call", {
    name: "patch_theme",
    arguments: { expectedRevision: document.revision, colors: { accent: "#123456" } },
  });
  assert.equal(JSON.parse(patched.result.content[0].text).current.colors.accent, "#123456");
  const stale = await rpc("tools/call", {
    name: "patch_theme",
    arguments: { expectedRevision: document.revision, colors: { accent: "#FFFFFF" } },
  });
  assert.equal(stale.result.isError, true);
  assert.match(stale.result.content[0].text, /Refresh and retry/);
  const endpoint = JSON.parse(await readFile(bridge.endpoint, "utf8"));
  const unauthorized = await fetch(`http://127.0.0.1:${endpoint.port}/tool`, { method: "POST", body: "{}" });
  assert.equal(unauthorized.status, 401);
  const contrast = await rpc("tools/call", {
    name: "check_contrast",
    arguments: { foreground: "#FFFFFF", background: "#000000" },
  });
  assert.equal(JSON.parse(contrast.result.content[0].text).requestedPair.ratio, 21);
  await bridge.close();
  bridge = new ThemeBridge(store);
  await bridge.ensure();
  const resumed = await rpc("tools/call", { name: "read_theme", arguments: {} });
  const restored = JSON.parse(resumed.result.content[0].text);
  assert.equal(restored.current.colors.accent, "#123456");
  assert.match(restored.capabilities.scope.activation, /Only manual/);
  const capabilities = await rpc("tools/call", { name: "read_capabilities", arguments: {} });
  assert.equal(JSON.parse(capabilities.result.content[0].text).version, 3);
  const activeBefore = restored.active;
  const pack = await rpc("tools/call", {
    name: "patch_pack",
    arguments: {
      expectedRevision: restored.revision,
      ui: {
        density: "compact",
        toolCards: "bordered",
        panel: {
          enabled: true,
          title: "Test panel",
          icon: "BookOpen",
          blocks: [{ type: "progress", label: "Done", value: 75 }],
        },
      },
    },
  });
  const draft = JSON.parse(pack.result.content[0].text);
  assert.equal(draft.current.ui.density, "compact");
  assert.equal(draft.current.ui.panel.blocks[0].value, 75);
  assert.deepEqual(draft.active, activeBefore);
  const saved = await rpc("tools/call", {
    name: "save_pack",
    arguments: { expectedRevision: draft.revision, name: "Saved UI pack" },
  });
  const savedPack = JSON.parse(saved.result.content[0].text);
  assert.equal(savedPack.saved.at(-1).ui.toolCards, "bordered");
  assert.deepEqual(savedPack.active, activeBefore);
  const illegal = await rpc("tools/call", { name: "activate", arguments: { expectedRevision: savedPack.revision } });
  assert.equal(illegal.result.isError, true);
});
