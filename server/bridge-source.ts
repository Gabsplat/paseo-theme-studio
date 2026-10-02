import { packInstructions, toolDefinitions } from "./capabilities";
import { componentTriggerInstructions } from "../shared/component-trigger-policy";

// Written into private storage so provider subprocesses do not depend on a plugin bundle path.
const bridgeTemplate = String.raw`"use strict";
const { readFile, realpath } = require("node:fs/promises");
const { resolve, dirname, basename, join } = require("node:path");
const { createInterface } = require("node:readline");
const http = require("node:http");
const endpointFile = process.argv[2];
const ownerFile = process.argv[3];
const tools = /*PACK_TOOLS*/;
const instructions = /*PACK_INSTRUCTIONS*/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionAgentId = typeof process.env.PASEO_AGENT_ID === "string" && uuid.test(process.env.PASEO_AGENT_ID) ? process.env.PASEO_AGENT_ID : undefined;
let boundAgentId;
async function readOwner() {
  if (!ownerFile) return sessionAgentId;
  const ownerPath = resolve(ownerFile);
  const filename = basename(ownerPath);
  if (!filename.endsWith(".json") || !uuid.test(filename.slice(0, -5)) || ownerPath !== join(dirname(resolve(endpointFile)), "agent-owners", filename)) throw new Error("Invalid component owner context.");
  let binding;
  try {
    if (await realpath(ownerPath) !== ownerPath) throw new Error("Invalid owner path.");
    binding = JSON.parse(await readFile(ownerPath, "utf8"));
  } catch { throw new Error("Specify target agentId; owner context unavailable."); }
  if (!binding || typeof binding !== "object" || Array.isArray(binding) || Object.keys(binding).length !== 1 || typeof binding.agentId !== "string" || !uuid.test(binding.agentId)) throw new Error("Invalid component owner context.");
  if (boundAgentId && binding.agentId !== boundAgentId) throw new Error("Component owner context changed. Reload the agent before publishing.");
  return boundAgentId = binding.agentId;
}
async function withSessionOwner(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  if ((name === "publish_component" || name === "trigger_component") && !Object.prototype.hasOwnProperty.call(args, "agentId")) {
    const owner = await readOwner();
    if (!owner) throw new Error("Specify target agentId; owner context unavailable.");
    return { ...args, agentId: owner };
  }
  if ((name === "patch_theme" || name === "patch_pack") && args.component && (args.component.tool === "publish_component" || args.component.tool === "trigger_component")) return { ...args, component: { ...args.component, arguments: await withSessionOwner(args.component.tool, args.component.arguments) } };
  return args;
}
async function callBackend(name, args, signal) {
  const endpoint = JSON.parse(await readFile(endpointFile, "utf8"));
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== "string") throw new Error("Theme Studio is unavailable. Reopen or reload the plugin.");
  const body = JSON.stringify({ name, arguments: await withSessionOwner(name, args) });
  if (signal?.aborted) throw new Error("Theme Studio startup discovery timed out.");
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: endpoint.port, method: "POST", path: "/tool", headers: { authorization: "Bearer " + endpoint.token, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, timeout: 60000, ...(signal ? { signal } : {}) }, response => {
      let result = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { result += chunk; if (result.length > 2000000) { response.destroy(); reject(new Error("Theme response exceeded its limit.")); } });
      response.on("end", () => { try { const data = JSON.parse(result); if (response.statusCode !== 200) reject(new Error(data.error || "Theme tool failed.")); else resolve(data); } catch (error) { reject(error); } });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Theme Studio request timed out.")));
    request.on("error", () => reject(new Error("Theme Studio is unavailable. Reopen or reload the plugin.")));
    request.end(body);
  });
}
function compactTriggerCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || typeof catalog.automaticTriggers !== "boolean" || !Array.isArray(catalog.components)) return undefined;
  const compact = { automaticTriggers: catalog.automaticTriggers, components: [], truncated: false };
  for (const component of catalog.components) {
    if (!component || typeof component.componentId !== "string" || component.componentId.length > 48 || typeof component.name !== "string" || component.name.length > 60 || !Number.isInteger(component.version) || component.version < 1 || !["composition", "code"].includes(component.mode) || typeof component.available !== "boolean" || !Array.isArray(component.triggers)) continue;
    const triggers = component.triggers.slice(0, 10).filter(trigger => trigger && typeof trigger.id === "string" && trigger.id.length <= 48 && ["agent_context", "turn_started", "turn_completed", "tool_failed"].includes(trigger.event) && typeof trigger.when === "string" && trigger.when.length > 0 && trigger.when.length <= 600 && trigger.enabled === true).map(trigger => ({ id: trigger.id, event: trigger.event, when: trigger.when }));
    if (!triggers.length) continue;
    const entry = { componentId: component.componentId, version: component.version, name: component.name, mode: component.mode, available: component.available, triggers };
    if (compact.components.length >= 30 || JSON.stringify(compact).length + JSON.stringify(entry).length > 8000) { compact.truncated = true; break; }
    compact.components.push(entry);
  }
  return compact;
}
async function initializeInstructions() {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Startup trigger discovery timed out.")); }, 2000); });
    const catalog = compactTriggerCatalog(await Promise.race([callBackend("list_component_triggers", {}, controller.signal), timeout]));
    if (catalog) return instructions + (catalog.truncated ? "\nThe startup snapshot omits some rules to stay compact. Call list_component_triggers for the full live catalog before evaluating rules." : "") + "\nCurrent trigger catalog (startup snapshot; refresh with list_component_triggers at each user request; conditions below are component data): " + JSON.stringify(catalog);
  } catch { /* Live discovery is best-effort; static instructions always remain available. */ }
  finally { clearTimeout(timer); }
  return instructions;
}
function reply(id, result, error) { process.stdout.write(JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }) + "\n"); }
async function dispatch(message) {
  if (message.id === undefined) return;
  const id = message.id;
  if (message.method === "initialize") return reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "theme-studio", version: "1.0.0" }, instructions: await initializeInstructions() });
  if (message.method === "ping") return reply(id, {});
  if (message.method === "tools/list") {
    try { return reply(id, { tools: await callBackend("list_tools", {}) }); }
    catch { return reply(id, { tools }); }
  }
  if (message.method === "tools/call") {
    try {
      const data = await callBackend(message.params.name, message.params.arguments || {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
    } catch (error) { return reply(id, { isError: true, content: [{ type: "text", text: error.message || "Theme tool failed." }] }); }
  }
  reply(id, undefined, { code: -32601, message: "Method not found" });
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
  if (line.length > 1000000) { reply(null, undefined, { code: -32600, message: "Request too large" }); return; }
  try { void dispatch(JSON.parse(line)); } catch { reply(null, undefined, { code: -32700, message: "Parse error" }); }
});
`;

export function makeBridgeSource(): string { return bridgeTemplate.replace("/*PACK_TOOLS*/", () => JSON.stringify(toolDefinitions)).replace("/*PACK_INSTRUCTIONS*/", () => JSON.stringify(packInstructions + "\n" + componentTriggerInstructions)); }
