import assert from "node:assert/strict";
import { test } from "node:test";
import { connectAgent } from "./agent-integration";

test("native creation gains component MCP without replacing task, provider, environment, or other permissions", () => {
  const request = { config: { provider: "codex" as const, cwd: "/project", systemPrompt: "Build my application", mcpServers: { other: { type: "stdio" as const, command: "other" } }, toolPolicy: { preapproved: [{ kind: "mcp" as const, server: "other", tool: "read" }] } }, env: { EXISTING: "value" } };
  const bridge = { script: "/private/theme-mcp.cjs", endpoint: "/private/bridge.json" };
  const next = connectAgent(request, bridge, "/node");
  assert.equal(next.config.provider, request.config.provider); assert.deepEqual(next.env, request.env);
  assert.equal(next.config.mcpServers?.other, request.config.mcpServers.other);
  assert.match(next.config.systemPrompt!, /^Build my application/);
  assert.match(next.config.systemPrompt!, /agentId set to your own/);
  assert.deepEqual(next.config.mcpServers?.["theme-studio"], { type: "stdio", command: "/node", args: [bridge.script, bridge.endpoint] });
  assert.ok(next.config.toolPolicy!.preapproved.some(tool => tool.server === "other"));
  assert.ok(next.config.toolPolicy!.preapproved.some(tool => tool.tool === "update_component_state"));
  assert.deepEqual(connectAgent(next, bridge, "/node"), next);
  assert.deepEqual(request.config.mcpServers, { other: { type: "stdio", command: "other" } });
});
test("internal sessions and an explicit unrelated same-name server remain unchanged", () => {
  const bridge={ script: "/script", endpoint: "/endpoint" };
  const internal={config:{provider:"codex" as const,cwd:"/project",internal:true}};
  assert.equal(connectAgent(internal,bridge),internal);
  const custom={config:{provider:"codex" as const,cwd:"/project",mcpServers:{"theme-studio":{type:"stdio" as const,command:"custom"}}}};
  assert.equal(connectAgent(custom,bridge),custom);
});
test("owner binding is baked into MCP args and launch env, while unsupported providers are preserved",()=>{
 const bridge={script:"/theme/theme-mcp.cjs",endpoint:"/theme/bridge.json"},owner={token:"binding-token",path:"/theme/agent-owners/token.json"};
 const request={config:{provider:"codex" as const,cwd:"/project"},env:{OTHER:"keep"}};
 const next=connectAgent(request,bridge,"/node",owner);
 const server=next.config.mcpServers?.["theme-studio"];
 assert.equal(server?.type,"stdio");
 assert.deepEqual(server?.type==="stdio"?server.args:undefined,[bridge.script,bridge.endpoint,owner.path]);
 assert.deepEqual(next.env,{OTHER:"keep",PASEO_THEME_STUDIO_OWNER_TOKEN:owner.token});
 assert.deepEqual(connectAgent(next,bridge,"/node",owner),next);
 for(const provider of ["omp","pi","custom-acp"]){const unknown={config:{provider,cwd:"/project"}};assert.equal(connectAgent(unknown,bridge),unknown);}
});
