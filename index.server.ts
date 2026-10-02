import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readStudio, changeStudio, startDesigner, exportPack } from "./shared/rpc";
import { StudioStore } from "./server/store";
import { ThemeBridge } from "./server/bridge";
import { Designer } from "./server/designer";
import { PackExporter } from "./server/export";
import { ComponentService } from "./server/components";
import { ComponentController } from "./server/component-controller";
import { connectAgent } from "./server/agent-integration";
import { AgentConnectionStore } from "./server/agent-connection";
import { AgentOwners, ownerTokenEnvironment } from "./server/agent-owners";
import { componentTriggerCatalog } from "./server/component-triggers";
import { readAgentConnection, changeAgentConnection, readAgentMcpSetup } from "./shared/agent-connection";
import * as components from "./shared/component-rpc";
import { z } from "zod";

export default function contribute(server: PluginServerContext) {
  const directory = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "theme-studio");
  const store = new StudioStore(directory);
  const connection = new AgentConnectionStore(directory);
  const owners = new AgentOwners(directory);
  const componentService = new ComponentService(directory);
  const controller = new ComponentController(componentService, store);
  const bind = (context: PluginHandlerContext) => controller.bind(context.paseo);
  const bridge = new ThemeBridge(store, async (name, input) => {
    switch (name) {
      case "list_component_triggers": {
        z.object({}).strict().parse(input);
        return componentTriggerCatalog(await componentService.read(), (await connection.read()).automaticTriggers);
      }
      case "trigger_component": {
        const value = components.componentTriggerPublishSchema.parse(input);
        if (!(await connection.read()).automaticTriggers)
          throw new Error(
            "Automatic component triggers are disabled by the installer. Manual publication remains available.",
          );
        if (!value.agentId) throw new Error("Specify target agentId; owner context unavailable.");
        return controller.trigger({ ...value, agentId: value.agentId });
      }
      case "list_components":
        z.object({}).strict().parse(input);
        return componentService.read();
      case "read_component_instance":
        return controller.listInstance(components.readComponentInstance.input.parse(input).instanceId);
      case "create_composition":
        return componentService.createComposition(components.componentCreateSchema.parse(input));
      case "create_code_component":
        return componentService.createCode(components.componentCodeSchema.parse(input));
      case "build_components":
        return componentService.build(components.buildComponents.input.parse(input));
      case "publish_component":
        return (await controller.publish(components.componentPublishSchema.parse(input))).instance;
      case "update_component_state":
        return controller.updateState(components.componentUpdateSchema.parse(input));
      case "favorite_component": {
        const value = components.favoriteComponent.input.parse(input);
        return componentService.setFavorite({
          expectedRevision: value.expectedRevision,
          id: value.componentId,
          favorite: value.favorite,
        });
      }
      default:
        throw new Error("Unknown component tool.");
    }
  });
  const designer = new Designer(store, bridge);
  const removeCreateHook = server.before("agent.create", async ({ request }, context) => {
    let enabled = false;
    try {
      enabled = (await connection.read()).enabled;
    } catch {
      console.error("Theme Studio connection settings are unavailable. Preserving the agent's configuration.");
      return;
    }
    if (!enabled) return;
    bind(context);
    await bridge.ensure();
    return connectAgent(request, bridge, process.execPath, owners.allocate());
  });
  const removeSessionHook = server.before("agent.session_open", async ({ request }, context) => {
    bind(context);
    await bridge.ensure();
    if (request.reason === "create" && request.purpose === "interactive")
      await owners.bind(request.env[ownerTokenEnvironment], request.agentId);
  });
  const exporter = new PackExporter(store);
  // Existing persistent agents can reconnect their tools after a plugin reload.
  void bridge
    .ensure()
    .catch(error =>
      console.error("Theme Studio bridge could not start:", error instanceof Error ? error.message : "unknown error"),
    );
  server.handle(readStudio, (_, context) => {
    bind(context);
    return store.read();
  });
  server.handle(readAgentConnection, () => connection.read());
  server.handle(changeAgentConnection, input =>
    connection.change(input.expectedRevision, input.enabled, input.automaticTriggers),
  );
  server.handle(readAgentMcpSetup, async ({ provider }) => {
    await bridge.ensure();
    const command = process.execPath,
      args = [bridge.script, bridge.endpoint];
    const configuration =
      provider === "codex"
        ? `[mcp_servers.theme-studio]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`
        : JSON.stringify(
            provider === "opencode"
              ? { mcp: { "theme-studio": { type: "local", command: [command, ...args], enabled: true } } }
              : { mcpServers: { "theme-studio": { type: "stdio", command, args } } },
            null,
            2,
          );
    return {
      configuration,
      instructions:
        provider === "codex"
          ? "Add this section to your Codex config.toml. Reload the idle conversation after adding it. Provider configuration can also affect Codex outside Paseo."
          : provider === "opencode"
            ? "Merge this MCP entry into your OpenCode configuration. Reload the idle conversation after adding it."
            : "Merge this MCP entry into your Claude Code MCP configuration. Reload the idle conversation after adding it.",
    };
  });
  server.handle(exportPack, (input, context) => {
    bind(context);
    return exporter.export(input);
  });
  server.handle(changeStudio, ({ expectedRevision, action }, context) => {
    bind(context);
    return store.change(expectedRevision, action);
  });
  server.handle(startDesigner, (input, context) => {
    bind(context);
    return designer.start(input, context.paseo);
  });
  server.handle(components.readComponentLibrary, (_, context) => {
    bind(context);
    return componentService.read();
  });
  server.handle(components.createComposition, (input, context) => {
    bind(context);
    return componentService.createComposition(input);
  });
  server.handle(components.createCodeComponent, (input, context) => {
    bind(context);
    return componentService.createCode(input);
  });
  server.handle(components.favoriteComponent, (input, context) => {
    bind(context);
    return componentService.setFavorite({
      expectedRevision: input.expectedRevision,
      id: input.componentId,
      favorite: input.favorite,
    });
  });
  server.handle(components.buildComponents, (input, context) => {
    bind(context);
    return componentService.build(input);
  });
  server.handle(components.activateComponentBuild, async (input, context) => {
    bind(context);
    const result = await componentService.activateBuild(input);
    // Reply before reloading this worker. The source was reviewed and typechecked.
    setTimeout(() => {
      const child = spawn("paseo", ["plugin", "reload", "theme-studio", "--home", dirname(directory)], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", error => console.error("Component reload failed:", error.message));
      child.unref();
    }, 750);
    return result;
  });
  server.handle(components.publishComponent, async (input, context) => {
    bind(context);
    return (await controller.publish(input)).instance;
  });
  server.handle(components.readComponentInstance, (input, context) => {
    bind(context);
    return controller.listInstance(input.instanceId);
  });
  server.handle(components.interactComponent, async (input, context) => {
    bind(context);
    const result = await controller.interact(input);
    return {
      instance: result.instance,
      dispatch: result.delivery === "dispatched" ? ("sent" as const) : result.delivery,
    };
  });
  server.handle(components.updateComponentState, (input, context) => {
    bind(context);
    return controller.updateState(input);
  });
  const removeTurnHook = server.on("agent.turn_ended", async (event, context) => {
    bind(context);
    await controller.drain(event.agent.id);
  });
  const drainTimer = setInterval(() => {
    void controller.drain().catch(() => {});
  }, 5000);
  return async () => {
    clearInterval(drainTimer);
    removeCreateHook();
    removeSessionHook();
    removeTurnHook();
    await connection.close();
    await controller.close();
    await componentService.close();
    await designer.close();
    await bridge.close();
    await store.close();
  };
}
