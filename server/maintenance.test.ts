import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneMissingAgents } from "./maintenance";

test("maintenance removes data only for agents that Paseo reports missing", async () => {
  const removedFiles: string[] = [];
  let removedAgents: readonly string[] = [];
  const presence = { live: "present", gone: "missing", flaky: "unknown" } as const;
  const result = await pruneMissingAgents(
    { agentPresence: async id => presence[id as keyof typeof presence] },
    {
      read: async () => ({ instances: [{ agentId: "gone" }, { agentId: "flaky" }, { agentId: "live" }] }) as never,
      removeAgentInstances: async ids => {
        removedAgents = ids;
        return ids.length;
      },
    },
    {
      list: async () => [
        { file: "/owners/live.json", agentId: "live" },
        { file: "/owners/gone.json", agentId: "gone" },
      ],
      remove: async file => {
        removedFiles.push(file);
      },
    },
  );
  assert.deepEqual(removedAgents, ["gone"]);
  assert.deepEqual(removedFiles, ["/owners/gone.json"]);
  assert.deepEqual(result, { instances: 1, bindings: 1 });
});
