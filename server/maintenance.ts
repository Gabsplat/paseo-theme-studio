import type { AgentOwners } from "./agent-owners";
import type { ComponentController } from "./component-controller";
import type { ComponentService } from "./components";

/**
 * Removes component instances and owner bindings for agents that Paseo no longer knows.
 * Agents whose presence cannot be confirmed either way are left untouched.
 */
export async function pruneMissingAgents(
  controller: Pick<ComponentController, "agentPresence">,
  service: Pick<ComponentService, "instanceAgents" | "removeAgentInstances">,
  owners: Pick<AgentOwners, "list" | "remove">,
): Promise<{ instances: number; bindings: number }> {
  const bindings = await owners.list();
  const agentIds = new Set([...bindings.map(binding => binding.agentId), ...(await service.instanceAgents())]);
  const missing: string[] = [];
  for (const agentId of agentIds) if ((await controller.agentPresence(agentId)) === "missing") missing.push(agentId);
  const instances = await service.removeAgentInstances(missing);
  let removed = 0;
  for (const binding of bindings)
    if (missing.includes(binding.agentId)) {
      await owners.remove(binding.file);
      removed++;
    }
  return { instances, bindings: removed };
}
