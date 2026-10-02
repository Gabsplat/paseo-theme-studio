import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changeAgentConnection } from "../shared/agent-connection";
import { AgentConnectionStore } from "./agent-connection";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "theme-connection-"));
  const store = new AgentConnectionStore(directory);
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store };
}

test("new-agent connections remain opt-in while automatic component triggers default on", async t => {
  const { directory, store } = await fixture(t);
  const themeFile = join(directory, "studio.json");
  await writeFile(themeFile, '{"untouched":true}');
  assert.deepEqual(await store.read(), { revision: 0, enabled: false, automaticTriggers: true });
  const results = await Promise.allSettled([store.change(0, true), store.change(0, false)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.deepEqual(await new AgentConnectionStore(directory).read(), {
    revision: 1,
    enabled: true,
    automaticTriggers: true,
  });
  await store.change(1, false);
  assert.deepEqual(await store.read(), { revision: 2, enabled: false, automaticTriggers: true });
  assert.equal(await readFile(themeFile, "utf8"), '{"untouched":true}');
});

test("automatic triggers persist independently of the connection opt-in setting", async t => {
  const { directory, store } = await fixture(t);
  assert.deepEqual(await store.change(0, undefined, false), { revision: 1, enabled: false, automaticTriggers: false });
  assert.deepEqual(await new AgentConnectionStore(directory).read(), {
    revision: 1,
    enabled: false,
    automaticTriggers: false,
  });
  assert.deepEqual(await store.change(1, true), { revision: 2, enabled: true, automaticTriggers: false });
  assert.deepEqual(await store.change(2, undefined, true), { revision: 3, enabled: true, automaticTriggers: true });
  assert.deepEqual(await store.change(3, false), { revision: 4, enabled: false, automaticTriggers: true });
  assert.deepEqual(await new AgentConnectionStore(directory).read(), {
    revision: 4,
    enabled: false,
    automaticTriggers: true,
  });
});

test("legacy connection files gain automatic triggers without changing their opt-in or revision", async t => {
  const { directory, store } = await fixture(t);
  for (const enabled of [false, true]) {
    const legacy = JSON.stringify({ revision: 9, enabled });
    await writeFile(store.file, legacy);
    assert.deepEqual(await store.read(), { revision: 9, enabled, automaticTriggers: true });
    assert.equal(await readFile(store.file, "utf8"), legacy);
    assert.deepEqual(await store.change(9, undefined, false), { revision: 10, enabled, automaticTriggers: false });
    assert.deepEqual(await new AgentConnectionStore(directory).read(), {
      revision: 10,
      enabled,
      automaticTriggers: false,
    });
  }
});

test("stale trigger edits fail without overwriting connection changes and no-op settings preserve revisions", async t => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.change(0, undefined, true), { revision: 0, enabled: false, automaticTriggers: true });
  await store.change(0, true);
  await assert.rejects(store.change(0, undefined, false), /Connection settings changed/);
  assert.deepEqual(await store.read(), { revision: 1, enabled: true, automaticTriggers: true });
  assert.deepEqual(await store.change(1, true, true), { revision: 1, enabled: true, automaticTriggers: true });
});

test("the settings RPC accepts a trigger-only patch and preserves the absence of a connection patch", () => {
  const patch = changeAgentConnection.input.parse({ expectedRevision: 3, automaticTriggers: false });
  assert.deepEqual(patch, { expectedRevision: 3, automaticTriggers: false });
  assert.equal(Object.hasOwn(patch, "enabled"), false);
  assert.equal(changeAgentConnection.input.safeParse({ expectedRevision: 3 }).success, false);
});
