import assert from "node:assert/strict";
import test from "node:test";
import { componentEventPrompt } from "../shared/component-event";
import type { ComponentEvent, ComponentInstance, ComponentLibrary } from "../shared/components";
import { ComponentEventIndex, componentHasAgentUpdate } from "./component-events";

const event: ComponentEvent = { id: "0f862be9-1ff4-4fe5-bf49-2af71699e893", at: "2026-10-01T12:00:00Z", action: { action: "choose", value: "middle", patch: { choice: "middle" } }, state: { choice: "middle" }, dispatchedAt: null };
const instance: ComponentInstance = { id: "instance-one", componentId: "choices", componentVersion: 2, agentId: "agent-owner", state: { choice: "middle" }, revision: 1, events: [event], createdAt: event.at };
const library = (...instances: ComponentInstance[]): ComponentLibrary => ({ format: 1, revision: 1, definitions: [], instances, favorites: [], builds: [], activeKeys: [] });
const message = (text = componentEventPrompt(instance, event), clientMessageId = event.id) => ({ type: "user_message" as const, text, clientMessageId });

test("only the native message ID and complete persisted owned payload hide a queued interaction", () => {
  const index = new ComponentEventIndex();
  assert.equal(index.hides(message()), false);
  index.updateLibrary(library(instance));
  assert.equal(index.hides(message()), true);
  assert.equal(index.hides({ ...message(), messageId: "provider-message-id" }), true);
  assert.equal(index.hides({ type: "user_message", messageId: event.id, text: message().text }), true);
  index.updateInstance({ ...instance, events: [{ ...event, dispatchedAt: "2026-10-01T12:01:00Z" }] });
  assert.equal(index.hides(message()), true);
});

test("ordinary user messages, copied technical text in another agent, and provider-ID coincidences remain visible", () => {
  const index = new ComponentEventIndex(); index.updateInstance(instance);
  assert.equal(index.hides(message("Please show me the middle option.")), false);
  assert.equal(index.hides(message("The user explicitly interacted with a Theme Studio component.")), false);
  assert.equal(index.hides(message(message().text, "different-native-message-id")), false);
  assert.equal(index.hides({ type: "user_message", text: message().text }), false);
  assert.equal(index.hides({ ...message(message().text, "copied-message"), messageId: event.id }), false);
});

test("wrong owner, action, state, version, and extra payload fields fail open even with an event UUID", () => {
  const index = new ComponentEventIndex(); index.updateInstance(instance);
  const payload = JSON.parse(message().text.split("\n").at(-1)!);
  for (const change of [{ agentId: "another-agent" }, { action: { action: "execute" } }, { stateAtEvent: { choice: "first" } }, { componentVersion: 3 }, { unexpected: true }]) {
    assert.equal(index.hides(message(`A component event\n${JSON.stringify({ ...payload, ...change })}`)), false);
  }
  assert.equal(index.hides(message("{malformed JSON}")), false);
});

test("verified legacy payloads survive prompt wording changes without prefix-based hiding", () => {
  const index = new ComponentEventIndex(); index.updateInstance(instance);
  const payload = JSON.parse(message().text.split("\n").at(-1)!);
  delete payload.agentId;
  const reversed = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(index.hides(message(`Previous documented instruction wording.\n${JSON.stringify(reversed)}`)), true);
  assert.equal(index.hides(message(`Previous documented instruction wording.\n${JSON.stringify(reversed)}`, "ordinary-user-message")), false);
});

test("ambiguous event IDs from different owners or duplicate persisted events never hide messages", () => {
  const index = new ComponentEventIndex();
  index.updateLibrary(library(instance, { ...instance, id: "instance-two", agentId: "agent-other" }));
  assert.equal(index.hides(message()), false);
  const duplicate = new ComponentEventIndex(); duplicate.updateInstance({ ...instance, events: [event, event] });
  assert.equal(duplicate.hides(message()), false);
});

test("input-only events cannot hide chat and stale snapshots cannot overwrite a newer verified instance", () => {
  const index = new ComponentEventIndex();
  index.updateInstance({ ...instance, events: [{ ...event, action: { action: "__state__", patch: { input: "draft" } } }] });
  assert.equal(index.hides(message()), false);
  index.updateInstance({ ...instance, revision: 2 });
  index.updateLibrary(library({ ...instance, events: [], revision: 0 }));
  assert.equal(index.hides(message()), true);
  const invalidId = { ...event, id: "ordinary-message-id" };
  index.updateInstance({ ...instance, revision: 3, events: [invalidId] });
  assert.equal(index.hides(message(componentEventPrompt(instance, invalidId), invalidId.id)), false);
});

test("projection refreshes happen only when the verified allowlist changes, not on agent state or delivery updates", () => {
  const index = new ComponentEventIndex(); let refreshes = 0;
  const unsubscribe = index.subscribe(() => { refreshes++; });
  index.updateInstance(instance);
  index.updateInstance({ ...instance, state: { arbitraryResult: [1, 2] }, revision: 2, events: [{ ...event, dispatchedAt: event.at }] });
  assert.equal(refreshes, 1);
  unsubscribe();
  index.updateInstance({ ...instance, revision: 3, events: [...instance.events, { ...event, id: "event-two" }] });
  assert.equal(refreshes, 1);
});

test("generic agent updates differ from local input patches without assuming any domain state fields", () => {
  assert.equal(componentHasAgentUpdate(instance), false);
  const typing = { ...event, id: "input-event", action: { action: "__state__", patch: { notes: "Still typing" } }, state: { choice: "middle", notes: "Still typing" } };
  const withInput = { ...instance, state: { notes: "Still typing", choice: "middle" }, revision: 2, events: [event, typing] };
  assert.equal(componentHasAgentUpdate(withInput), false);
  assert.equal(componentHasAgentUpdate({ ...withInput, state: { ...withInput.state, arbitraryResult: { description: "Agent result" } }, revision: 3 }), true);
  assert.equal(componentHasAgentUpdate({ ...instance, events: [typing] }), false);
});
