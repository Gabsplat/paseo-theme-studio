import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { componentTriggersSchema, parseComponentTree, type ComponentNode } from "../shared/components";
import { ComponentRevisionConflict, ComponentService, validateComponentCode } from "./components";
import { exportAssets } from "./export-assets";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-components-test-"));
  const project = join(directory, "project");
  await mkdir(join(project, "shared"), { recursive: true });
  await mkdir(join(project, "client"));
  await writeFile(
    join(project, "shared/components.ts"),
    await readFile(join(exportAssets.projectDirectory, "shared/components.ts"), "utf8"),
  );
  await writeFile(join(project, "client/generated-components.tsx"), "export const generatedComponents = {};\n");
  await symlink(join(exportAssets.projectDirectory, "node_modules"), join(project, "node_modules"), "dir");
  const service = new ComponentService(join(directory, "storage"), project);
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { service, project };
}
const tree: ComponentNode = {
  type: "stack",
  children: [
    { type: "text", text: "Reusable checklist" },
    { type: "input", label: "Task", stateKey: "task", action: "__state__" },
    { type: "toggle", label: "Ready", stateKey: "ready", action: "ready" },
    {
      type: "select",
      label: "Priority",
      stateKey: "priority",
      action: "priority",
      options: [{ label: "High", value: "high" }],
    },
    { type: "button", label: "Review", action: "review", patch: { requested: true } },
  ],
};
const source = `import { View, Text, Pressable } from "react-native";
import type { ComponentProps } from "../../shared/components";
export default function Generated({theme,state,onAction}:ComponentProps) {
 return <View style={{padding:12,backgroundColor:theme.colors.surface1}}><Text style={{color:theme.colors.foreground}}>{String(state.title ?? "Saved component")}</Text><Pressable onPress={()=>onAction({action:"confirm",value:"yes",patch:{confirmed:true}})}><Text style={{color:theme.colors.accent}}>Confirm</Text></Pressable></View>;
}
`;
const triggers = [
  {
    id: "needs-review",
    event: "agent_context" as const,
    when: "When the user needs to compare implementation choices",
  },
  { id: "completed", event: "turn_completed" as const, when: "After completing the requested task", enabled: false },
];

test("component triggers are versioned, inherited only when omitted, and preserved for published instances", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const first = await service.createComposition({
    expectedRevision: initial.revision,
    id: "context-card",
    name: "Context card",
    tree,
    triggers,
  });
  assert.deepEqual(first.definition.triggers, componentTriggersSchema.parse(triggers));
  assert.equal(first.definition.triggers[0].enabled, true);
  const published = await service.createInstance({
    expectedRevision: first.library.revision,
    componentId: "context-card",
    agentId: "agent-01",
  });
  const inherited = await service.createComposition({
    expectedRevision: published.library.revision,
    id: "context-card",
    name: "Revised context",
    tree: { type: "text", text: "Second version" },
  });
  assert.deepEqual(inherited.definition.triggers, first.definition.triggers);
  const cleared = await service.createComposition({
    expectedRevision: inherited.library.revision,
    id: "context-card",
    name: "Manual only",
    tree,
    triggers: [],
  });
  assert.deepEqual(cleared.definition.triggers, []);
  const library = await new ComponentService(service.directory).read();
  assert.deepEqual(library.definitions[0], first.definition);
  assert.deepEqual(library.definitions[1], inherited.definition);
  assert.equal(library.instances[0].componentVersion, 1);
  assert.deepEqual(
    library.definitions.find(definition => definition.version === library.instances[0].componentVersion)?.triggers,
    first.definition.triggers,
  );
});

test("legacy definitions default to no triggers without rewriting storage or changing revision", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const created = await service.createComposition({
    expectedRevision: initial.revision,
    id: "legacy-card",
    name: "Legacy",
    tree,
  });
  const legacy = JSON.parse(await readFile(service.file, "utf8"));
  delete legacy.definitions[0].triggers;
  const before = JSON.stringify(legacy);
  await writeFile(service.file, before);
  const restored = await new ComponentService(service.directory).read();
  assert.equal(restored.revision, created.library.revision);
  assert.deepEqual(restored.definitions[0].triggers, []);
  assert.equal(await readFile(service.file, "utf8"), before);
});

test("invalid triggers reject both component modes before persistence or source validation", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const before = await readFile(service.file, "utf8");
  for (const invalid of [
    [triggers[0], triggers[0]],
    Array.from({ length: 11 }, (_, index) => ({ ...triggers[0], id: `trigger-${index}` })),
    [{ ...triggers[0], id: "../unsafe" }],
    [{ ...triggers[0], event: "run_command" }],
    [{ ...triggers[0], when: " " }],
    [{ ...triggers[0], when: "x".repeat(601) }],
    [{ ...triggers[0], enabled: "yes" }],
    [{ ...triggers[0], code: "execute()" }],
  ]) {
    await assert.rejects(
      service.createComposition({
        expectedRevision: initial.revision,
        id: "invalid-card",
        name: "Invalid",
        tree,
        triggers: invalid,
      }),
    );
    await assert.rejects(
      service.createCode({
        expectedRevision: initial.revision,
        id: "invalid-code",
        name: "Invalid",
        code: "not valid TSX",
        triggers: invalid,
      }),
      error => !String(error).includes("Component TSX could not be parsed"),
    );
  }
  assert.equal(await readFile(service.file, "utf8"), before);
});

test("concurrent trigger retries reuse one pinned instance without replacing user state or advancing revision", async t => {
  const { service, project } = await fixture(t);
  const other = new ComponentService(service.directory, project);
  const initial = await service.read();
  const created = await service.createComposition({
    expectedRevision: initial.revision,
    id: "context-card",
    name: "Context",
    tree,
    triggers,
  });
  const input = {
    expectedRevision: created.library.revision,
    componentId: created.definition.id,
    version: 1,
    agentId: "agent-one",
    state: { count: 1 },
    trigger: {
      id: "needs-review",
      event: "agent_context",
      turnId: "actual-turn-01",
      turnStartedAt: "2026-10-01T12:00:00.000Z",
    },
  };
  const results = await Promise.all([service.createInstance(input), other.createInstance(input)]);
  assert.deepEqual(results.map(result => result.reused).sort(), [false, true]);
  assert.equal(results[0].instance.id, results[1].instance.id);
  const instance = results[0].instance;
  assert.equal(instance.trigger?.occurrenceKey, "default");
  assert.equal((await service.read()).instances.length, 1);
  assert.equal((await service.read()).revision, created.library.revision + 1);
  const updated = await service.updateInstance({ instanceId: instance.id, expectedRevision: 0, state: { count: 8 } });
  const before = (await service.read()).revision;
  const retry = await service.createInstance({ ...input, state: { count: 999 } });
  assert.equal(retry.reused, true);
  assert.deepEqual(retry.instance, updated);
  assert.equal(retry.library.revision, before);
  await assert.rejects(
    service.createInstance({ ...input, trigger: { ...input.trigger, turnId: "different-turn" } }),
    ComponentRevisionConflict,
  );
});

test("reloaded provider turn IDs remain separate by the real turn start, including concurrent retries and persisted reads", async t => {
  const { service, project } = await fixture(t);
  const other = new ComponentService(service.directory, project);
  const created = await service.createComposition({
    expectedRevision: (await service.read()).revision,
    id: "context-card",
    name: "Context",
    tree,
    triggers,
  });
  const input = {
    componentId: created.definition.id,
    version: 1,
    agentId: "agent-one",
    trigger: {
      id: "needs-review",
      event: "agent_context",
      turnId: "codex-turn-0",
      turnStartedAt: "2026-10-01T12:00:00.000Z",
    },
  };
  const first = await service.createInstance({ ...input, expectedRevision: created.library.revision });
  const nextInput = {
    ...input,
    expectedRevision: first.library.revision,
    trigger: { ...input.trigger, turnStartedAt: "2026-10-01T12:01:00.000Z" },
  };
  const retried = await Promise.all([service.createInstance(nextInput), other.createInstance(nextInput)]);
  assert.deepEqual(retried.map(result => result.reused).sort(), [false, true]);
  assert.equal(retried[0].instance.id, retried[1].instance.id);
  assert.notEqual(retried[0].instance.id, first.instance.id);
  assert.equal(retried[0].instance.trigger?.turnId, first.instance.trigger?.turnId);
  assert.equal(retried[0].instance.trigger?.turnStartedAt, nextInput.trigger.turnStartedAt);
  const restored = await new ComponentService(service.directory, project).read();
  assert.equal(restored.instances.length, 2);
  assert.equal(restored.revision, first.library.revision + 1);
  assert.deepEqual(restored.instances[0], first.instance);
});

test("legacy trigger provenance without a start stays readable and is distinct from new timestamped turns", async t => {
  const { service, project } = await fixture(t);
  const created = await service.createComposition({
    expectedRevision: (await service.read()).revision,
    id: "context-card",
    name: "Context",
    tree,
    triggers,
  });
  const input = {
    componentId: created.definition.id,
    version: 1,
    agentId: "agent-one",
    trigger: { id: "needs-review", event: "agent_context", turnId: "codex-turn-0" },
  };
  const legacy = await service.createInstance({ ...input, expectedRevision: created.library.revision });
  const before = await readFile(service.file, "utf8");
  const restored = await new ComponentService(service.directory, project).read();
  assert.equal(Object.hasOwn(restored.instances[0].trigger!, "turnStartedAt"), false);
  assert.equal(await readFile(service.file, "utf8"), before);
  const retry = await service.createInstance({
    ...input,
    expectedRevision: created.library.revision,
    trigger: { ...input.trigger, turnStartedAt: null },
  });
  assert.equal(retry.reused, true);
  assert.equal(retry.instance.id, legacy.instance.id);
  assert.equal(retry.library.revision, legacy.library.revision);
  const timestamped = await service.createInstance({
    ...input,
    expectedRevision: legacy.library.revision,
    trigger: { ...input.trigger, turnStartedAt: "2026-10-01T12:00:00.000Z" },
  });
  assert.equal(timestamped.reused, false);
  assert.notEqual(timestamped.instance.id, legacy.instance.id);
  assert.equal((await service.read()).instances.length, 2);
});

test("trigger identity separates owners, turns, occurrences, and immutable versions", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const first = await service.createComposition({
    expectedRevision: initial.revision,
    id: "context-card",
    name: "Context",
    tree,
    triggers,
  });
  const base = {
    componentId: first.definition.id,
    version: 1,
    agentId: "agent-one",
    trigger: { id: "needs-review", event: "agent_context", turnId: "actual-turn-01", occurrenceKey: "tool-one" },
  };
  const instances = [];
  for (const input of [
    base,
    { ...base, agentId: "agent-two" },
    { ...base, trigger: { ...base.trigger, turnId: "actual-turn-02" } },
    { ...base, trigger: { ...base.trigger, occurrenceKey: "tool-two" } },
  ])
    instances.push(
      (await service.createInstance({ ...input, expectedRevision: (await service.read()).revision })).instance,
    );
  const second = await service.createComposition({
    expectedRevision: (await service.read()).revision,
    id: first.definition.id,
    name: "Revised",
    tree,
  });
  instances.push(
    (
      await service.createInstance({
        ...base,
        version: second.definition.version,
        expectedRevision: second.library.revision,
      })
    ).instance,
  );
  assert.equal(new Set(instances.map(instance => instance.id)).size, 5);
  assert.equal(instances[0].componentVersion, 1);
  assert.equal(instances[4].componentVersion, 2);
  const restored = await new ComponentService(service.directory).read();
  assert.deepEqual(restored.instances, instances);
  const normal = await service.createInstance({
    componentId: base.componentId,
    agentId: base.agentId,
    expectedRevision: restored.revision,
  });
  assert.equal(Object.hasOwn(normal, "reused"), false);
  assert.equal(Object.hasOwn(normal.instance, "trigger"), false);
});

test("undeclared, disabled, mismatched, unpinned, and malformed trigger publication cannot change storage", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const created = await service.createComposition({
    expectedRevision: initial.revision,
    id: "context-card",
    name: "Context",
    tree,
    triggers,
  });
  const base = {
    expectedRevision: created.library.revision,
    componentId: created.definition.id,
    version: 1,
    agentId: "agent-one",
    trigger: { id: "needs-review", event: "agent_context", turnId: "actual-turn-01" },
  };
  const before = await readFile(service.file, "utf8");
  for (const trigger of [
    { ...base.trigger, id: "not-declared" },
    { ...base.trigger, id: "completed", event: "turn_completed" },
    { ...base.trigger, event: "tool_failed" },
    { ...base.trigger, turnId: "" },
    { ...base.trigger, turnStartedAt: "" },
    { ...base.trigger, turnStartedAt: 123 },
    { ...base.trigger, turnStartedAt: "x".repeat(81) },
    { ...base.trigger, occurrenceKey: " " },
  ])
    await assert.rejects(service.createInstance({ ...base, trigger }));
  await assert.rejects(service.createInstance({ ...base, version: undefined }), /explicit immutable version/);
  assert.equal(await readFile(service.file, "utf8"), before);
});

test("composition versions and favorites persist independently of their instances", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const first = await service.createComposition({
    expectedRevision: initial.revision,
    id: "checklist",
    name: "Checklist",
    tree,
  });
  const published = await service.createInstance({
    expectedRevision: first.library.revision,
    componentId: "checklist",
    agentId: "agent-01",
    state: { title: "First", ready: false },
  });
  const second = await service.createComposition({
    expectedRevision: published.library.revision,
    id: "checklist",
    name: "Checklist revised",
    tree: { type: "text", text: "Different version" },
  });
  assert.equal(second.definition.version, 2);
  assert.deepEqual(second.library.definitions[0], first.definition);
  assert.equal(second.library.instances[0].componentVersion, 1);
  const favorite = await service.setFavorite({
    expectedRevision: second.library.revision,
    id: "checklist",
    favorite: true,
  });
  assert.deepEqual(favorite.favorites, ["checklist"]);
  assert.deepEqual(await new ComponentService(service.directory).read(), favorite);
  assert.equal((await stat(service.file)).mode & 0o777, 0o600);
});

test("concurrent library and instance updates reject stale revisions without losing data", async t => {
  const { service } = await fixture(t);
  const initial = await service.read();
  const other = new ComponentService(service.directory);
  const results = await Promise.allSettled([
    service.createComposition({ expectedRevision: initial.revision, id: "one", name: "One", tree }),
    other.createComposition({ expectedRevision: initial.revision, id: "two", name: "Two", tree }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(results.some(result => result.status === "rejected" && result.reason instanceof ComponentRevisionConflict));
  let library = await service.read();
  const componentId = library.definitions[0].id;
  const created = await service.createInstance({
    expectedRevision: library.revision,
    componentId,
    agentId: "agent-01",
  });
  const events = await Promise.allSettled([
    service.interact({
      instanceId: created.instance.id,
      expectedRevision: 0,
      action: { action: "confirm", patch: { choice: "first" } },
    }),
    other.interact({
      instanceId: created.instance.id,
      expectedRevision: 0,
      action: { action: "confirm", patch: { choice: "second" } },
    }),
  ]);
  assert.equal(events.filter(result => result.status === "fulfilled").length, 1);
  const instance = await service.readInstance(created.instance.id);
  assert.equal(instance.revision, 1);
  assert.equal(instance.events.length, 1);
  assert.deepEqual(instance.events[0].state, instance.state);
  const beforeDispatch = (await service.read()).revision;
  const marked = await service.markDispatched({ instanceId: instance.id, eventId: instance.events[0].id });
  assert.ok(marked.events[0].dispatchedAt);
  assert.deepEqual(await service.markDispatched({ instanceId: instance.id, eventId: instance.events[0].id }), marked);
  assert.equal((await service.read()).revision, beforeDispatch + 1);
});

test("bounded composition validates interactive data and rejects recursion, unsafe IDs, and corrupt storage", async t => {
  const { service } = await fixture(t);
  let deep: ComponentNode = { type: "text", text: "leaf" };
  for (let level = 0; level < 8; level++) deep = { type: "stack", children: [deep] };
  assert.throws(() => parseComponentTree(deep), /six nested levels/);
  assert.throws(() => parseComponentTree({ type: "button", label: "Invalid", action: "go", script: "eval()" }));
  const initial = await service.read();
  await assert.rejects(
    service.createComposition({ expectedRevision: initial.revision, id: "../outside", name: "Bad", tree }),
  );
  assert.equal((await service.read()).revision, initial.revision);
  const invalid = '{"format":1,"revision":0,"definitions":[{"mode":"broken"}]}';
  await writeFile(service.file, invalid);
  await assert.rejects(service.read(), /existing file has been preserved/);
  assert.equal(await readFile(service.file, "utf8"), invalid);
});

test("code import validation rejects non-native and dynamic execution but accepts public typed JSX", () => {
  validateComponentCode(source);
  for (const invalid of [
    'import fs from "node:fs"; export default function Card(){return null}',
    'import {Icon} from "lucide-react-native"; export default function Card(){return null}',
    'export default function Card(){return <div className="bad"/>}',
    'export default function Card(){return eval("null")}',
    'export default function Card(){return import("react")}',
    'export default function Card(){return window.localStorage.getItem("x")}',
    'export default function Card(){return [].map.constructor("return 1")()}',
    'export default function Card(){const f=[].map["constructor"];return null}',
    'export default function Card(){return Reflect.get(self,"x")}',
    'import { Linking } from "react-native"; export default function Card(){return null}',
    'import { NativeModules as N } from "react-native"; export default function Card(){return null}',
    'import * as RN from "react-native"; export default function Card(){return null}',
  ])
    assert.throws(() => validateComponentCode(invalid), /Unsupported|native|Dynamic/i);
});

test("code builds typecheck all immutable versions before manual activation and preserve historical renderers", async t => {
  const { service, project } = await fixture(t);
  const initial = await service.read();
  const first = await service.createCode({
    expectedRevision: initial.revision,
    id: "decision-card",
    name: "Decision card",
    code: source,
    triggers,
  });
  await assert.rejects(
    service.createInstance({
      expectedRevision: first.library.revision,
      componentId: "decision-card",
      agentId: "agent-01",
    }),
    /Build and activate/,
  );
  const built = await service.build({ expectedRevision: first.library.revision });
  assert.equal(built.validation.typecheck, true);
  assert.deepEqual(built.build.keys, ["decision-card@1"]);
  assert.deepEqual((await service.read()).activeKeys, []);
  assert.equal(
    await readFile(join(project, "client/generated-components.tsx"), "utf8"),
    "export const generatedComponents = {};\n",
  );
  await assert.rejects(stat(join(built.build.directory, "node_modules")), { code: "ENOENT" });
  await assert.rejects(
    service.activateBuild({ expectedRevision: built.library.revision, buildId: built.build.id, reviewedKeys: [] }),
    /Review the source/,
  );
  const activated = await service.activateBuild({
    expectedRevision: built.library.revision,
    buildId: built.build.id,
    reviewedKeys: built.build.keys,
  });
  assert.equal(activated.reloadRequired, true);
  assert.deepEqual(activated.library.activeKeys, ["decision-card@1"]);
  const created = await service.createInstance({
    expectedRevision: activated.library.revision,
    componentId: "decision-card",
    version: 1,
    agentId: "agent-01",
    trigger: { id: "needs-review", event: "agent_context", turnId: "code-turn-01" },
  });
  assert.equal(created.instance.componentVersion, 1);
  assert.equal(created.reused, false);
  const second = await service.createCode({
    expectedRevision: created.library.revision,
    id: "decision-card",
    name: "Decision card v2",
    code: source.replace("Saved component", "Version two"),
  });
  assert.deepEqual(second.definition.triggers, first.definition.triggers);
  const rebuilt = await service.build({ expectedRevision: second.library.revision });
  assert.deepEqual(rebuilt.build.keys, ["decision-card@1", "decision-card@2"]);
  const latest = await service.activateBuild({
    expectedRevision: rebuilt.library.revision,
    buildId: rebuilt.build.id,
    reviewedKeys: rebuilt.build.keys,
  });
  const registry = await readFile(join(project, "client/generated-components.tsx"), "utf8");
  assert.match(registry, /decision-card@1/);
  assert.match(registry, /decision-card@2/);
  assert.equal((await service.readInstance(created.instance.id)).componentVersion, 1);
  await assert.rejects(
    service.activateBuild({
      expectedRevision: latest.library.revision,
      buildId: built.build.id,
      reviewedKeys: built.build.keys,
    }),
    /previously active component version/,
  );
  assert.equal(await readFile(join(project, "client/generated-components.tsx"), "utf8"), registry);
});

test("failed or modified code candidates cannot alter activated source or active keys", async t => {
  const { service, project } = await fixture(t);
  let library = await service.read();
  const first = await service.createCode({
    expectedRevision: library.revision,
    id: "valid-card",
    name: "Valid",
    code: source,
  });
  const built = await service.build({ expectedRevision: first.library.revision });
  await writeFile(
    join(built.build.directory, "client/generated/valid-card-v1.tsx"),
    source + "// modified after check\n",
  );
  await assert.rejects(
    service.activateBuild({
      expectedRevision: built.library.revision,
      buildId: built.build.id,
      reviewedKeys: built.build.keys,
    }),
    /changed after validation/,
  );
  library = await service.read();
  assert.deepEqual(library.activeKeys, []);
  await assert.rejects(
    service.createCode({
      expectedRevision: library.revision,
      id: "bad-card",
      name: "Bad",
      code: 'import type {ComponentProps} from "../../shared/components"; export default function Broken({theme}:ComponentProps) {return theme.nonexistent;}',
    }),
    /failed typechecking/,
  );
  assert.equal((await service.read()).revision, library.revision);
  assert.equal((await service.read()).definitions.length, 1);
  assert.equal(
    await readFile(join(project, "client/generated-components.tsx"), "utf8"),
    "export const generatedComponents = {};\n",
  );
  assert.deepEqual((await service.read()).activeKeys, []);
});

test("delivered events are trimmed while undelivered events are never dropped", async t => {
  const { service } = await fixture(t);
  const created = await service.createComposition({ expectedRevision: 0, id: "events-card", name: "Events", tree });
  let { instance } = await service.createInstance({
    expectedRevision: created.library.revision,
    componentId: "events-card",
    agentId: "agent-events",
  });
  for (let index = 0; index < 60; index++) {
    const result = await service.interact({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      action: { action: "ready", value: index },
    });
    instance = await service.markDispatched({ instanceId: instance.id, eventId: result.event.id });
  }
  const pending = await service.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "ready", value: "pending" },
  });
  const stored = await service.readInstance(instance.id);
  assert.equal(stored.events.filter(event => event.dispatchedAt).length, 50);
  assert.ok(stored.events.some(event => event.id === pending.event.id && event.dispatchedAt === null));
  assert.equal((await service.removeAgentInstances(["agent-events"])) as number, 1);
  assert.equal((await service.read()).instances.length, 0);
});

test("deleting a component removes all versions, favorites, instances, and stale builds", async t => {
  const { service } = await fixture(t);
  let library = (await service.createComposition({ expectedRevision: 0, id: "old-card", name: "Old", tree })).library;
  library = (
    await service.createComposition({ expectedRevision: library.revision, id: "old-card", name: "Old 2", tree })
  ).library;
  library = (
    await service.createComposition({ expectedRevision: library.revision, id: "kept-card", name: "Kept", tree })
  ).library;
  library = await service.setFavorite({ expectedRevision: library.revision, id: "old-card", favorite: true });
  const created = await service.createInstance({
    expectedRevision: library.revision,
    componentId: "old-card",
    agentId: "agent-delete",
  });
  await assert.rejects(
    service.deleteComponent({ expectedRevision: created.library.revision - 1, id: "old-card" }),
    ComponentRevisionConflict,
  );
  const deleted = await service.deleteComponent({ expectedRevision: created.library.revision, id: "old-card" });
  assert.equal(deleted.removedInstances, 1);
  assert.deepEqual(
    deleted.library.definitions.map(item => item.id),
    ["kept-card"],
  );
  assert.deepEqual(deleted.library.favorites, []);
  assert.equal(deleted.library.instances.length, 0);
  await assert.rejects(service.readInstance(created.instance.id), /not found/);
  await assert.rejects(
    service.deleteComponent({ expectedRevision: deleted.library.revision, id: "old-card" }),
    /not found/,
  );
});
