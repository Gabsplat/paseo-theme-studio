import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PluginHandlerContext, PluginHookContext } from "@getpaseo/plugin/server";
import type { ComponentInstance } from "../shared/components";
import { ComponentController } from "./component-controller";
import { ComponentRevisionConflict, ComponentService } from "./components";
import { StudioStore } from "./store";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "component-controller-test-"));
  const service = new ComponentService(directory);
  const studio = new StudioStore(directory);
  const initial = await studio.read();
  await studio.mutate(initial.revision, document => ({
    ...document,
    designerAgentId: "designer-owner",
    designerWorkspaceId: "designer-workspace",
  }));
  const studioBefore = await readFile(studio.file, "utf8");
  const created = await service.createComposition({
    expectedRevision: 0,
    id: "payment-form",
    name: "Payment form",
    tree: {
      type: "stack",
      children: [
        { type: "input", label: "Amount", stateKey: "amount", action: "amount-changed" },
        { type: "button", label: "Register", action: "register-payment" },
      ],
    },
  });
  const status = {
    value: "idle",
    turnId: "native-turn",
    startedAt: "2026-10-02T00:00:00.000Z" as string | null,
    archived: false,
    permission: false,
    unavailable: false,
    finishedAttention: false,
  };
  const timeline: Array<{ owner: string; item: any }> = [];
  const canonical: Array<{ owner: string; item: any; turnId?: string }> = [];
  const sendRequests: Array<{ owner: string; text: string; messageId: string }> = [];
  const delivered = new Set<string>();
  const paseo = {
    agents: {
      ref: (owner: string) => ({
        id: owner,
        get archivedAt() {
          return status.archived ? "2026-01-01T00:00:00Z" : null;
        },
        get status() {
          return status.value;
        },
        get activeTurn() {
          return status.value === "running" ? { turnId: status.turnId, startedAt: status.startedAt } : null;
        },
        get pendingPermissions() {
          return status.permission ? [{ id: "permission-request" }] : [];
        },
        refresh: async () => ({
          agent: {
            providerUnavailable: status.unavailable,
            requiresAttention: status.permission || status.finishedAttention,
            attentionReason: status.permission ? "permission" : status.finishedAttention ? "finished" : null,
          },
        }),
        timeline: {
          append: async (item: any) => {
            timeline.push({ owner, item });
            canonical.push({ owner, item: { ...item, pluginId: "theme-studio" }, turnId: status.turnId });
            return { seq: timeline.length, epoch: "native-epoch" };
          },
          refetch: async () => ({
            agentId: owner,
            error: null,
            staleCursor: false,
            hasOlder: false,
            startCursor: null,
            entries: canonical
              .filter(entry => entry.owner === owner)
              .map(entry => ({ item: entry.item, turnId: entry.turnId })),
          }),
        },
        send: async (text: string, options: { messageId: string }) => {
          sendRequests.push({ owner, text, messageId: options.messageId });
          if (!delivered.has(options.messageId)) {
            delivered.add(options.messageId);
            status.value = "running";
            canonical.push({
              owner,
              item: { type: "user_message", text, clientMessageId: options.messageId },
              turnId: status.turnId,
            });
          }
        },
      }),
    },
  } as unknown as PluginHandlerContext["paseo"];
  const controller = new ComponentController(service, studio);
  controller.bind(paseo);
  t.after(async () => {
    await controller.close();
    await service.close();
    await studio.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function publish(owner?: string): Promise<ComponentInstance> {
    const library = await service.read();
    return (
      await controller.publish({
        expectedRevision: library.revision,
        componentId: created.definition.id,
        ...(owner ? { agentId: owner } : {}),
        state: { amount: 0 },
      })
    ).instance;
  }
  return {
    controller,
    service,
    studio,
    studioBefore,
    status,
    timeline,
    canonical,
    sendRequests,
    delivered,
    paseo,
    publish,
  };
}

test("publishing a validated composition immediately appends one native pointer row owned by the chosen agent", async t => {
  const fixtureData = await fixture(t);
  const { controller, service, studio, studioBefore, timeline, sendRequests, publish } = fixtureData;
  const instance = await publish();
  assert.equal(instance.agentId, "designer-owner");
  assert.deepEqual(timeline, [
    {
      owner: "designer-owner",
      item: {
        type: "plugin",
        id: instance.id,
        kind: "studio-component",
        version: 1,
        data: {
          instanceId: instance.id,
          componentId: instance.componentId,
          componentVersion: instance.componentVersion,
        },
      },
    },
  ]);
  assert.equal(sendRequests.length, 0);
  const explicit = await publish("other-explicit-owner");
  assert.equal(explicit.agentId, "other-explicit-owner");
  assert.equal(timeline[1].owner, "other-explicit-owner");
  assert.equal((await controller.listInstance(instance.id)).definition.mode, "composition");
  const library = await service.read();
  await assert.rejects(
    controller.publish({ expectedRevision: library.revision - 1, componentId: instance.componentId }),
    ComponentRevisionConflict,
  );
  assert.equal(timeline.length, 2);
  assert.equal(await readFile(studio.file, "utf8"), studioBefore);
});

test("code components require an active validated version before any instance or timeline row is created", async t => {
  const { controller, service, timeline } = await fixture(t);
  const before = await service.read();
  const code = await service.createCode({
    expectedRevision: before.revision,
    id: "code-card",
    name: "Code card",
    code: 'import { View } from "react-native"; export default function Component() { return <View />; }',
  });
  await assert.rejects(
    controller.publish({ expectedRevision: code.library.revision, componentId: code.definition.id }),
    /Build and load/,
  );
  assert.equal((await service.read()).instances.length, 0);
  assert.equal(timeline.length, 0);
});

test("state-only input records local data without a model turn; submission routes typed data and agent state updates cannot loop", async t => {
  const { controller, service, studio, studioBefore, sendRequests, publish } = await fixture(t);
  let instance = await publish();
  const input = await controller.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "__state__", patch: { amount: 1200, currency: "BRL" } },
  });
  assert.equal(input.delivery, "state-only");
  assert.equal(input.instance.state.amount, 1200);
  assert.ok(input.event.dispatchedAt);
  assert.equal(sendRequests.length, 0);
  await assert.rejects(
    controller.interact({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      action: { action: "register-payment" },
    }),
    ComponentRevisionConflict,
  );
  instance = input.instance;
  const submitted = await controller.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "register-payment", value: { account: "cash", amount: 1200 } },
  });
  assert.equal(submitted.delivery, "dispatched");
  assert.equal(sendRequests.length, 1);
  assert.equal(sendRequests[0].messageId, submitted.event.id);
  const payload = JSON.parse(sendRequests[0].text.slice(sendRequests[0].text.indexOf('{"type":')));
  assert.deepEqual(payload.action.value, { account: "cash", amount: 1200 });
  assert.equal(payload.stateAtEvent.amount, 1200);
  assert.equal(submitted.instance.state.result, undefined);
  const answered = await controller.updateState({
    instanceId: instance.id,
    expectedRevision: submitted.instance.revision,
    state: { ...submitted.instance.state, result: { status: "recorded", reference: "txn-1" } },
  });
  assert.deepEqual(answered.state.result, { status: "recorded", reference: "txn-1" });
  assert.equal(answered.events.length, 2);
  await assert.rejects(
    controller.updateState({ instanceId: instance.id, expectedRevision: submitted.instance.revision, state: {} }),
    ComponentRevisionConflict,
  );
  await controller.drain();
  assert.equal(sendRequests.length, 1);
  assert.equal((await service.readInstance(instance.id)).events.length, 2);
  assert.equal(await readFile(studio.file, "utf8"), studioBefore);
});

test("busy and permission-blocked owners retain explicit events, then concurrent drains send each event once", async t => {
  const { controller, service, status, sendRequests, delivered, paseo, studio, publish } = await fixture(t);
  const instance = await publish();
  status.value = "running";
  const first = await controller.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "register-payment", value: 1 },
  });
  const second = await controller.interact({
    instanceId: instance.id,
    expectedRevision: first.instance.revision,
    action: { action: "register-payment", value: 2 },
  });
  assert.equal(first.delivery, "queued");
  assert.equal(second.delivery, "queued");
  assert.equal(sendRequests.length, 0);
  status.value = "idle";
  status.permission = true;
  assert.equal((await controller.drain()).dispatched.length, 0);
  status.permission = false;
  status.finishedAttention = true;
  await Promise.all([controller.drain("designer-owner"), controller.drain("designer-owner")]);
  assert.equal(sendRequests.length, 1);
  assert.equal(sendRequests[0].messageId, first.event.id);
  assert.equal((await service.readInstance(instance.id)).events[1].dispatchedAt, null);
  status.value = "idle";
  const restarted = new ComponentController(new ComponentService(service.directory), studio);
  restarted.bind(paseo);
  await restarted.drain();
  await restarted.drain();
  await restarted.close();
  assert.equal(sendRequests.length, 2);
  assert.equal(delivered.size, 2);
  assert.equal(sendRequests[1].messageId, second.event.id);
});

test("SDK message IDs deduplicate a retry after delivery succeeds but the persisted marker fails", async t => {
  const { controller, service, status, sendRequests, delivered, publish } = await fixture(t);
  const instance = await publish();
  const markDispatched = service.markDispatched.bind(service);
  let failMarker = true;
  service.markDispatched = async input => {
    if (failMarker) {
      failMarker = false;
      throw new Error("Temporary marker write failure");
    }
    return markDispatched(input);
  };
  const submitted = await controller.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "register-payment" },
  });
  assert.equal(submitted.delivery, "unavailable");
  assert.match(submitted.error ?? "", /marker write failure/);
  assert.equal(submitted.event.dispatchedAt, null);
  status.value = "idle";
  await controller.drain("designer-owner");
  assert.equal(sendRequests.length, 2);
  assert.equal(sendRequests[0].messageId, sendRequests[1].messageId);
  assert.equal(delivered.size, 1);
  assert.ok((await service.readInstance(instance.id)).events[0].dispatchedAt);
});

test("a three-option interaction keeps decisions and processing/result feedback in agent-owned component state", async t => {
  const { controller, service, studio, studioBefore, sendRequests } = await fixture(t);
  const library = await service.read();
  const created = await service.createComposition({
    expectedRevision: library.revision,
    id: "choose-next-step",
    name: "Choose next step",
    tree: {
      type: "stack",
      children: [
        { type: "button", label: "Research", action: "choose", value: "research" },
        { type: "button", label: "Compare", action: "choose", value: "compare" },
        { type: "button", label: "Summarize", action: "choose", value: "summarize" },
        { type: "stat", label: "Next step", value: "Choose an option", stateKey: "feedback" },
      ],
    },
  });
  const published = await controller.publish({
    expectedRevision: created.library.revision,
    componentId: created.definition.id,
    state: { note: "Keep this input", processing: false, feedback: "Choose an option" },
  });
  const clicked = await controller.interact({
    instanceId: published.instance.id,
    expectedRevision: published.instance.revision,
    action: { action: "choose", value: "compare" },
  });
  assert.equal(clicked.delivery, "dispatched");
  assert.equal(clicked.instance.state.processing, false, "The controller must not invent agent progress.");
  assert.equal(
    clicked.instance.state.result,
    undefined,
    "The backend cannot decide the selected option's domain result.",
  );
  const request = sendRequests[0];
  assert.equal(request.messageId, clicked.event.id);
  assert.match(request.text, /component instance and definition/);
  assert.match(request.text, /processing:true/);
  assert.match(request.text, /processing:false/);
  assert.match(request.text, /Do not add a separate chat narration/);
  assert.match(request.text, /do not send another message or start a follow-up turn/);
  const payload = JSON.parse(request.text.slice(request.text.indexOf('{"type":')));
  assert.equal(payload.agentId, published.instance.agentId);
  assert.deepEqual(payload.action, { action: "choose", value: "compare" });
  const working = await controller.updateState({
    instanceId: clicked.instance.id,
    expectedRevision: clicked.instance.revision,
    state: { ...clicked.instance.state, processing: true, feedback: "Comparing the options…" },
  });
  await assert.rejects(
    controller.updateState({
      instanceId: working.id,
      expectedRevision: clicked.instance.revision,
      state: { result: "stale" },
    }),
    ComponentRevisionConflict,
  );
  const completed = await controller.updateState({
    instanceId: working.id,
    expectedRevision: working.revision,
    state: {
      ...working.state,
      processing: false,
      feedback: "Comparison ready",
      result: { selected: "compare", explanation: "Agent-decided result" },
    },
  });
  assert.equal(completed.state.note, "Keep this input");
  assert.equal(completed.events.length, 1);
  await controller.drain();
  assert.equal(sendRequests.length, 1);
  assert.deepEqual((await service.readInstance(completed.id)).state.result, {
    selected: "compare",
    explanation: "Agent-decided result",
  });
  assert.equal(await readFile(studio.file, "utf8"), studioBefore);
});

test("a public lifecycle hook can bind headless MCP publication without opening a client surface or launching a turn", async t => {
  const { service, studio, paseo, timeline, sendRequests } = await fixture(t);
  const headless = new ComponentController(service, studio);
  const context: PluginHookContext = { paseo, signal: new AbortController().signal };
  headless.bindContext(context);
  const library = await service.read();
  const created = await headless.publish({
    expectedRevision: library.revision,
    componentId: "payment-form",
    agentId: "existing-native-agent",
    state: { amount: 20 },
  });
  assert.equal(created.instance.agentId, "existing-native-agent");
  assert.equal(timeline.at(-1)?.owner, "existing-native-agent");
  assert.equal(sendRequests.length, 0);
  await headless.close();
  assert.throws(() => headless.bindContext(context), /controller has stopped/);
});

async function triggeredFixture(t: { after(callback: () => Promise<void>): void }) {
  const data = await fixture(t);
  const library = await data.service.read();
  const created = await data.service.createComposition({
    expectedRevision: library.revision,
    id: "task-context",
    name: "Task context",
    tree: { type: "stat", label: "Task", value: "", stateKey: "task" },
    triggers: [
      {
        id: "show-context",
        event: "agent_context",
        when: "When the current task benefits from seeing its context",
        enabled: true,
      },
      { id: "disabled-context", event: "tool_failed", when: "When a task needs recovery", enabled: false },
    ],
  });
  const trigger = { componentId: created.definition.id, triggerId: "show-context", agentId: "ordinary-owner" };
  return { ...data, trigger, definition: created.definition };
}

test("trigger publication uses the public live turn, deduplicates its occurrence, and remains independent across turns and owners", async t => {
  const { controller, service, status, trigger, timeline, sendRequests, studio, studioBefore } =
    await triggeredFixture(t);
  await assert.rejects(controller.trigger(trigger), /requires its owner's active Paseo turn/);
  status.value = "running";
  status.turnId = "actual-native-turn-one";
  await assert.rejects(controller.trigger({ ...trigger, turnId: "forged-turn" } as any));
  const first = await controller.trigger({ ...trigger, state: { task: "Native context" } });
  assert.equal(first.reused, false);
  assert.equal(first.instance.trigger?.turnId, status.turnId);
  assert.equal(first.instance.trigger?.turnStartedAt, status.startedAt);
  assert.equal(first.instance.trigger?.event, "agent_context");
  const repeated = await controller.trigger({ ...trigger, state: { task: "Do not overwrite previous state" } });
  assert.equal(repeated.reused, true);
  assert.deepEqual(repeated.instance, first.instance);
  assert.equal(timeline.length, 1);
  const distinctOccurrence = await controller.trigger({
    ...trigger,
    occurrenceKey: "second-task",
    state: { task: "Different task" },
  });
  assert.notEqual(distinctOccurrence.instance.id, first.instance.id);
  status.turnId = "actual-native-turn-two";
  const nextTurn = await controller.trigger(trigger);
  assert.notEqual(nextTurn.instance.id, first.instance.id);
  const differentOwner = await controller.trigger({ ...trigger, agentId: "another-ordinary-owner" });
  assert.equal(differentOwner.instance.agentId, "another-ordinary-owner");
  assert.notEqual(differentOwner.instance.id, nextTurn.instance.id);
  assert.equal((await service.read()).instances.length, 4);
  assert.equal(
    sendRequests.length,
    0,
    "Automatic publication must use the existing turn without invoking another model turn.",
  );
  assert.equal(await readFile(studio.file, "utf8"), studioBefore);
});

test("concurrent trigger calls coalesce one persisted instance and native row without replacing user state", async t => {
  const { controller, service, status, trigger, timeline, sendRequests } = await triggeredFixture(t);
  status.value = "running";
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) => controller.trigger({ ...trigger, state: { task: `request-${index}` } })),
  );
  assert.equal(new Set(results.map(result => result.instance.id)).size, 1);
  assert.equal(results.filter(result => !result.reused).length, 1);
  assert.equal((await service.read()).instances.length, 1);
  assert.equal(timeline.length, 1);
  assert.equal(sendRequests.length, 0);
});

test("trigger declaration, owner availability, and active code validation reject before any publication", async t => {
  const { controller, service, status, trigger, timeline } = await triggeredFixture(t);
  status.value = "running";
  const before = await service.read();
  for (const input of [
    { ...trigger, triggerId: "missing-rule" },
    { ...trigger, triggerId: "disabled-context" },
    { ...trigger, version: 999 },
    { ...trigger, agentId: "" },
  ])
    await assert.rejects(controller.trigger(input));
  status.archived = true;
  await assert.rejects(controller.trigger(trigger), /owner agent is unavailable/);
  status.archived = false;
  status.unavailable = true;
  await assert.rejects(controller.trigger(trigger), /owner agent is unavailable/);
  status.unavailable = false;
  assert.deepEqual(await service.read(), before);
  const code = await service.createCode({
    expectedRevision: before.revision,
    id: "triggered-code",
    name: "Triggered code",
    code: 'import { View } from "react-native"; export default function Component() { return <View />; }',
    triggers: [{ id: "show-context", event: "agent_context", when: "When context is useful", enabled: true }],
  });
  await assert.rejects(controller.trigger({ ...trigger, componentId: code.definition.id }), /Build and load/);
  assert.equal((await service.read()).instances.length, 0);
  assert.equal(timeline.length, 0);
});

test("a lost append acknowledgement recovers the persisted trigger by checking its native pointer instead of appending twice", async t => {
  const { controller, service, status, trigger, timeline, paseo } = await triggeredFixture(t);
  status.value = "running";
  const originalRef = paseo.agents.ref.bind(paseo.agents);
  let loseAcknowledgement = true;
  paseo.agents.ref = ((owner: string) => {
    const agent = originalRef(owner);
    const append = agent.timeline.append.bind(agent.timeline);
    agent.timeline.append = async item => {
      const result = await append(item);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("Lost append acknowledgement");
      }
      return result;
    };
    return agent;
  }) as typeof paseo.agents.ref;
  await assert.rejects(controller.trigger(trigger), /Lost append acknowledgement/);
  const recovered = await controller.trigger(trigger);
  assert.equal(recovered.reused, true);
  assert.equal(timeline.length, 1);
  assert.equal((await service.read()).instances.length, 1);
});

test("reused trigger recovery searches older canonical pages and accepts only this plugin's exact pointer", async t => {
  const { controller, service, status, trigger, definition, timeline, paseo } = await triggeredFixture(t);
  status.value = "running";
  const library = await service.read();
  const saved = await service.createInstance({
    expectedRevision: library.revision,
    componentId: definition.id,
    version: definition.version,
    agentId: trigger.agentId,
    trigger: {
      id: trigger.triggerId,
      event: "agent_context",
      turnId: status.turnId,
      turnStartedAt: status.startedAt,
      occurrenceKey: "default",
    },
  });
  const pointer = {
    type: "plugin",
    id: saved.instance.id,
    pluginId: "theme-studio",
    kind: "studio-component",
    version: 1,
    data: {
      instanceId: saved.instance.id,
      componentId: saved.instance.componentId,
      componentVersion: saved.instance.componentVersion,
    },
  };
  const originalRef = paseo.agents.ref.bind(paseo.agents);
  let olderReads = 0;
  paseo.agents.ref = ((owner: string) => {
    const agent = originalRef(owner);
    agent.timeline.refetch = (async (options: Parameters<typeof agent.timeline.refetch>[0]) => {
      if (options?.direction === "before") olderReads++;
      return {
        agentId: owner,
        error: null,
        staleCursor: false,
        hasOlder: options?.direction !== "before",
        startCursor: { epoch: "native-epoch", seq: options?.direction === "before" ? 1 : 100 },
        entries: [{ item: options?.direction === "before" ? pointer : { ...pointer, pluginId: "another-plugin" } }],
      };
    }) as unknown as typeof agent.timeline.refetch;
    return agent;
  }) as typeof paseo.agents.ref;
  const result = await controller.trigger(trigger);
  assert.equal(result.reused, true);
  assert.equal(olderReads, 2, "Callback verification and pointer recovery each check the older canonical page.");
  assert.equal(timeline.length, 0, "A pre-existing canonical pointer must not be re-appended.");
});

test("an interaction callback skips automatic triggers and ordinary user messages cannot impersonate its verified event", async t => {
  const { controller, service, status, trigger, timeline, canonical, sendRequests } = await triggeredFixture(t);
  status.value = "running";
  const shown = await controller.trigger(trigger);
  status.value = "idle";
  status.turnId = "interaction-callback-turn";
  const callback = await controller.interact({
    instanceId: shown.instance.id,
    expectedRevision: shown.instance.revision,
    action: { action: "review-task" },
  });
  assert.equal(callback.delivery, "dispatched");
  await assert.rejects(
    controller.trigger(trigger),
    /skipped while handling a component interaction.*Update the existing instance/,
  );
  assert.equal(timeline.length, 1);
  assert.equal(sendRequests.length, 1);
  const library = await service.read();
  const followup = await service.createComposition({
    expectedRevision: library.revision,
    id: "task-followup",
    name: "Task followup",
    tree: { type: "text", text: "Followup stage" },
    triggers: [
      {
        id: "show-followup",
        event: "agent_context",
        when: "When reviewing the task leads to a distinct followup stage",
        enabled: true,
      },
    ],
  });
  const nextStage = await controller.trigger({
    componentId: followup.definition.id,
    triggerId: "show-followup",
    agentId: trigger.agentId,
  });
  assert.equal(
    nextStage.reused,
    false,
    "A different component can match the callback context without repeating its originating component.",
  );
  assert.equal(timeline.length, 2);
  status.turnId = "ordinary-next-user-turn";
  canonical.push({
    owner: trigger.agentId,
    turnId: status.turnId,
    item: { type: "user_message", clientMessageId: "ordinary-user-message", text: sendRequests[0].text },
  });
  const ordinary = await controller.trigger(trigger);
  assert.equal(
    ordinary.reused,
    false,
    "Only the persisted event's own native message identity can block a callback trigger.",
  );
  assert.equal((await service.read()).instances.length, 3);
  assert.equal(sendRequests.length, 1);
});

test("trigger CAS retries tolerate library edits but stop after a bounded number without replacing anything", async t => {
  const { controller, service, status, trigger, timeline } = await triggeredFixture(t);
  status.value = "running";
  const original = service.createInstance.bind(service);
  let attempts = 0;
  service.createInstance = async input => {
    if (++attempts < 3) throw new ComponentRevisionConflict(input.expectedRevision + 1);
    return original(input);
  };
  await controller.trigger(trigger);
  assert.equal(attempts, 3);
  assert.equal(timeline.length, 1);
  status.turnId = "another-live-turn";
  const before = await service.read();
  attempts = 0;
  service.createInstance = async input => {
    attempts++;
    throw new ComponentRevisionConflict(input.expectedRevision + 1);
  };
  await assert.rejects(controller.trigger(trigger), ComponentRevisionConflict);
  assert.equal(attempts, 5);
  assert.deepEqual(await service.read(), before);
  assert.equal(timeline.length, 1);
});

test("callback verification pages past tool rows and fails closed on an unverifiable cursor", async t => {
  const { controller, service, status, trigger, timeline, canonical, paseo } = await triggeredFixture(t);
  status.value = "running";
  const shown = await controller.trigger(trigger);
  status.value = "idle";
  status.turnId = "long-callback-turn";
  await controller.interact({
    instanceId: shown.instance.id,
    expectedRevision: shown.instance.revision,
    action: { action: "review-task" },
  });
  const callback = canonical.findLast(entry => entry.item.type === "user_message")!;
  const originalRef = paseo.agents.ref.bind(paseo.agents);
  const directions: string[] = [];
  let brokenCursor = false;
  paseo.agents.ref = ((id: string) => {
    const agent = originalRef(id);
    agent.timeline.refetch = (async (options: { direction: string }) => {
      directions.push(options.direction);
      return {
        agentId: id,
        error: null,
        staleCursor: false,
        hasOlder: options.direction === "tail",
        startCursor: brokenCursor ? null : { epoch: "long-history", seq: 200 },
        entries:
          options.direction === "tail"
            ? Array.from({ length: 100 }, () => ({
                item: { type: "assistant_message", text: "Tool activity" },
                turnId: status.turnId,
              }))
            : [callback],
      };
    }) as typeof agent.timeline.refetch;
    return agent;
  }) as typeof paseo.agents.ref;
  await assert.rejects(controller.trigger(trigger), /skipped while handling a component interaction/);
  assert.deepEqual(directions, ["tail", "before"]);
  assert.equal(timeline.length, 1);
  const library = await service.read();
  const next = await service.createComposition({
    expectedRevision: library.revision,
    id: "next-step",
    name: "Next step",
    tree: { type: "text", text: "Next" },
    triggers: [
      { id: "next-step", event: "agent_context", when: "The reviewed task needs a different next step", enabled: true },
    ],
  });
  await controller.trigger({ componentId: next.definition.id, triggerId: "next-step", agentId: trigger.agentId });
  assert.equal(timeline.length, 2, "Long callback histories still permit another component's matching stage.");
  brokenCursor = true;
  await assert.rejects(controller.trigger(trigger), /could not be fully checked/);
  assert.equal(timeline.length, 2);
});

test("provider-recycled raw turn IDs remain distinct through the public turn start time", async t => {
  const { controller, service, status, trigger, timeline } = await triggeredFixture(t);
  status.value = "running";
  status.turnId = "codex-turn-0";
  const first = await controller.trigger(trigger);
  assert.equal((await controller.trigger(trigger)).reused, true);
  status.startedAt = "2026-10-02T00:10:00.000Z";
  const afterReload = await controller.trigger(trigger);
  assert.equal(afterReload.reused, false);
  assert.notEqual(afterReload.instance.id, first.instance.id);
  assert.equal(afterReload.instance.trigger?.turnId, first.instance.trigger?.turnId);
  assert.notEqual(afterReload.instance.trigger?.turnStartedAt, first.instance.trigger?.turnStartedAt);
  assert.equal((await controller.trigger(trigger)).reused, true);
  assert.equal(timeline.length, 2);
  status.startedAt = null;
  await assert.rejects(controller.trigger(trigger), /turn's start time is unavailable/);
  assert.equal(
    (await service.read()).instances.length,
    2,
    "Unknown start context must not silently reuse a prior turn.",
  );
});

test("unbound and archived owners surface unavailable delivery while preserving the event for a later retry", async t => {
  const { controller, service, status, sendRequests, studio, publish } = await fixture(t);
  const instance = await publish();
  const unbound = new ComponentController(service, studio);
  const first = await unbound.interact({
    instanceId: instance.id,
    expectedRevision: instance.revision,
    action: { action: "register-payment" },
  });
  assert.equal(first.delivery, "unavailable");
  assert.match(first.error ?? "", /Open Theme Studio/);
  await unbound.close();
  status.archived = true;
  const blocked = await controller.drain();
  assert.match(blocked.errors[0].message, /archived/);
  assert.equal((await service.readInstance(instance.id)).events[0].dispatchedAt, null);
  assert.equal(sendRequests.length, 0);
  status.archived = false;
  await controller.drain();
  assert.equal(sendRequests.length, 1);
});

test("a publication whose chat row cannot be appended leaves no orphaned instance", async t => {
  const { controller, service, paseo, publish } = await fixture(t);
  const ref = paseo.agents.ref.bind(paseo.agents);
  (paseo.agents as { ref: typeof ref }).ref = (owner: string) => {
    const agent = ref(owner);
    agent.timeline.append = async () => {
      throw new Error("Timeline unavailable");
    };
    return agent;
  };
  await assert.rejects(publish(), /Timeline unavailable/);
  assert.equal((await service.read()).instances.length, 0);
  (paseo.agents as { ref: typeof ref }).ref = ref;
  controller.bind(paseo);
  assert.ok(await publish());
  assert.equal((await service.read()).instances.length, 1);
});
