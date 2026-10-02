import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { AgentOwners } from "./agent-owners";
test("owner binding survives reload and cannot be redirected or replaced", async t => {
  const dir = await mkdtemp(join(tmpdir(), "theme-owners-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const owners = new AgentOwners(dir),
    owner = owners.allocate(),
    id = "00000000-0000-4000-8000-000000000001";
  await Promise.all([owners.bind(owner.token, id), owners.bind(owner.token, id)]);
  assert.deepEqual(JSON.parse(await readFile(owner.path, "utf8")), { agentId: id });
  await new AgentOwners(dir).bind(owner.token, id);
  await assert.rejects(owners.bind(owner.token, "00000000-0000-4000-8000-000000000002"), /another agent/);
  await assert.rejects(owners.bind("../../other", id), /Invalid/);
});
