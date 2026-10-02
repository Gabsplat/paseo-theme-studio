// Isolated native UI and real-model QA; never run against the main daemon.
// PASEO_QA_ORIGIN=http://127.0.0.1:7789 PASEO_QA_HOME=/home/gabsplat/Labs/theme-studio-components-qa/home pnpm exec node scripts/qa-component-triggers.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const origin = process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:7789";
const home = process.env.PASEO_QA_HOME || "/home/gabsplat/Labs/theme-studio-components-qa/home";
const root = "/home/gabsplat/Labs/theme-studio-components-qa";
assert.equal(origin, "http://127.0.0.1:7789");
assert.equal(resolve(home), join(root, "home"));
assert.equal(await realpath(home), resolve(home));
assert.equal(await realpath(join(root, "plugin")), join(root, "plugin"));
const output = resolve("output");
await mkdir(output, { recursive: true });
const json = async file => JSON.parse(await readFile(file, "utf8"));
const studio = () => json(join(home, "theme-studio/studio.json"));
const library = () => json(join(home, "theme-studio/components.json"));
const connection = () => json(join(home, "theme-studio/agent-connection.json"));
const hash = async file => {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
const mainFiles = [
  "/home/gabsplat/.paseo/theme-studio/studio.json",
  "/home/gabsplat/.paseo/theme-studio/designer.json",
  "/home/gabsplat/.paseo/theme-studio/agent-connection.json",
  "/home/gabsplat/Programming/theme-creator/client/generated-components.tsx",
];
const mainBefore = await Promise.all(mainFiles.map(hash));
const cli = promisify(execFile);
const cliEnvironment = { ...process.env };
delete cliEnvironment.PASEO_AGENT_ID;
delete cliEnvironment.PASEO_WORKSPACE_ID;
const host = "127.0.0.1:7789";
const runId = Date.now().toString(36);
const matchingId = `qa-launch-${runId}`,
  nonmatchingId = `qa-recipe-${runId}`;
const title = `QA automatic launch ${runId}`,
  cwd = join(root, `automatic-${runId}`);
await mkdir(cwd, { recursive: true });
const userTask =
  "I run a small neighborhood bakery and want to introduce home delivery. Prepare a concise three-step launch plan with practical actions for reaching nearby customers and keeping delivery reliable. Do not ask me questions.";
assert.doesNotMatch(userTask, /theme\s?studio|component|widget|\btool\b|\bmcp\b/i);
const tree = {
  type: "stack",
  gap: 10,
  children: [
    { type: "text", text: "Delivery launch progress" },
    { type: "stat", label: "Task", value: "Delivery launch", stateKey: "task" },
    { type: "stat", label: "Status", value: "Planning", stateKey: "feedback" },
    { type: "stat", label: "Next action", value: "", stateKey: "result" },
  ],
};
const matchingRules = [
  {
    id: "delivery-launch",
    event: "agent_context",
    when: "When the user asks for a practical launch plan for a bakery introducing home delivery. Show the task and progress while planning; state.task names the task, state.feedback reports progress, and state.result is a short human-readable next action.",
    enabled: true,
  },
];
const nonmatchingRules = [
  {
    id: "baking-recipe",
    event: "agent_context",
    when: "Only when the user specifically requests a gluten-free sourdough baking recipe. Delivery marketing and launch planning do not match this condition.",
    enabled: true,
  },
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PASEO_QA_CHROMIUM ? { executablePath: process.env.PASEO_QA_CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const checks = [];
let agentId, studioUrl, before, initialConnection;
async function until(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let nextReport = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (Date.now() >= nextReport) {
      console.log(JSON.stringify({ stage: `Waiting for ${label}`, agentId }));
      nextReport += 10000;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function openLibrary() {
  await page.goto(studioUrl);
  await page
    .getByTestId("theme-studio")
    .filter({ visible: true })
    .last()
    .getByRole("tab", { name: "Components", exact: true })
    .click();
  // The full library opens from the Components inspector.
  await page
    .getByTestId("theme-studio")
    .filter({ visible: true })
    .last()
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.getByTestId("component-library").filter({ visible: true }).last().waitFor();
}
async function saveComposition(id, name, composition, triggers) {
  const surface = page.getByTestId("component-library").filter({ visible: true }).last();
  await surface.getByRole("button", { name: "New composition", exact: true }).click();
  await page.getByRole("textbox", { name: "Component name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Component ID", exact: true }).fill(id);
  await page.getByRole("textbox", { name: "Component triggers JSON", exact: true }).fill(JSON.stringify(triggers));
  await page.getByRole("textbox", { name: "Composition JSON", exact: true }).fill(JSON.stringify(composition));
  const refresh = page.getByRole("button", { name: "Use latest library revision", exact: true });
  if (await refresh.isVisible()) await refresh.click();
  await page.getByRole("button", { name: "Save component", exact: true }).click();
  await until("persisted component trigger metadata", async () =>
    (await library()).definitions.some(definition => definition.id === id),
  );
  await page.getByRole("textbox", { name: "Composition JSON", exact: true }).waitFor({ state: "hidden" });
}
async function setAutomatic(enabled) {
  const current = (await connection()).automaticTriggers ?? true;
  if (current !== enabled)
    await page.getByRole("switch", { name: "Automatic component triggers", exact: true }).click();
  await until(
    "automatic trigger setting persistence",
    async () => ((await connection()).automaticTriggers ?? true) === enabled,
  );
}
async function restoreSettings() {
  if (!initialConnection || !studioUrl) return;
  await openLibrary();
  await setAutomatic(initialConnection.automaticTriggers ?? true);
  const current = await connection();
  if (current.enabled !== initialConnection.enabled) {
    await page
      .getByRole("button", { name: current.enabled ? "Disconnect new agents" : "Connect new agents", exact: true })
      .click();
    await until(
      "isolated connection restoration",
      async () => (await connection()).enabled === initialConnection.enabled,
    );
  }
}
try {
  await page.goto(origin);
  await page.getByText("Theme Studio", { exact: true }).first().click();
  await page.getByTestId("theme-studio").waitFor();
  studioUrl = page.url();
  before = await studio();
  await openLibrary();
  initialConnection = await connection();
  await saveComposition(matchingId, "Delivery launch progress", tree, matchingRules);
  await saveComposition(
    nonmatchingId,
    "Gluten-free recipe",
    { type: "text", text: "Baking recipe details" },
    nonmatchingRules,
  );
  checks.push(
    "Installer saved two custom components with matching and nonmatching natural-language trigger metadata through native UI",
  );
  await setAutomatic(true);
  if (!(await connection()).enabled) {
    await page.getByRole("button", { name: "Connect new agents", exact: true }).click();
    await until("installer opt-in", async () => (await connection()).enabled);
  }
  await page.screenshot({ path: join(output, "component-triggers-library.png") });
  const started = Date.now();
  const run = JSON.parse(
    (
      await cli(
        "paseo",
        [
          "--host",
          host,
          "run",
          "--background",
          "--provider",
          "codex",
          "--model",
          "gpt-6.1-sol",
          "--thinking",
          "high",
          "--mode",
          "auto",
          "--cwd",
          cwd,
          "--title",
          title,
          "--json",
          userTask,
        ],
        { env: cliEnvironment, timeout: 60000, maxBuffer: 2000000 },
      )
    ).stdout,
  );
  agentId = run.agentId;
  assert.match(agentId, /^[0-9a-f-]{36}$/i);
  console.log(
    JSON.stringify({
      stage: "General agent handling ordinary business request; no tools or UI named by user",
      agentId,
    }),
  );
  await until(
    "automatic declared-trigger publication",
    async () => {
      const current = await library();
      if (current.instances.some(instance => instance.agentId === agentId && instance.componentId === matchingId))
        return true;
      const state = JSON.parse(
        (await cli("paseo", ["--host", host, "inspect", agentId, "--json"], { maxBuffer: 1000000 })).stdout,
      );
      if (state.Status === "idle")
        throw new Error("The general agent finished without publishing its matching declared trigger.");
      return false;
    },
    300000,
  );
  await until(
    "ordinary business turn idle",
    async () =>
      JSON.parse((await cli("paseo", ["--host", host, "inspect", agentId, "--json"], { maxBuffer: 1000000 })).stdout)
        .Status === "idle",
    300000,
  );
  const current = await library();
  const owned = current.instances.filter(instance => instance.agentId === agentId);
  assert.equal(owned.length, 1, "One matching rule must produce one instance, without a generic or nonmatching card.");
  const instance = owned[0];
  assert.equal(instance.componentId, matchingId);
  assert.equal(instance.trigger.id, matchingRules[0].id);
  assert.equal(instance.trigger.event, "agent_context");
  assert.ok(instance.trigger.turnId);
  assert.ok(
    !current.instances.some(instance => instance.agentId === agentId && instance.componentId === nonmatchingId),
  );
  assert.equal((await studio()).designerAgentId, before.designerAgentId);
  checks.push(
    "Ordinary task automatically matched only its declared component, used the owner session and actual native turn, and published one persistent instance",
  );
  const workspaces = JSON.parse(
    (await cli("paseo", ["--host", host, "workspace", "ls", "--json"], { maxBuffer: 2000000 })).stdout,
  );
  const workspace = workspaces.find(workspace => workspace.cwd === cwd);
  const { serverId } = await json(join(home, "paseo.pid"));
  const chatUrl = `${origin}/h/${serverId}/workspace/${workspace.workspaceId}`;
  await page.goto(chatUrl);
  await page.getByText("Delivery launch progress", { exact: true }).last().waitFor({ timeout: 30000 });
  await page.getByText("Delivery launch progress", { exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "component-triggers-native-chat.png") });
  await page.reload();
  await page.getByText("Delivery launch progress", { exact: true }).last().waitFor({ timeout: 30000 });
  checks.push("Automatically published native row and provenance survived browser reload");
  const logs = (
    await cli("paseo", ["--host", host, "logs", agentId, "--tail", "150", "--json"], { maxBuffer: 6000000 })
  ).stdout;
  assert.match(logs, /list_component_triggers/);
  assert.match(logs, /trigger_component/);
  await writeFile(join(output, "component-triggers-agent-timeline.json"), logs);
  await openLibrary();
  await setAutomatic(false);
  const endpoint = await json(join(home, "theme-studio/bridge.json"));
  const blocked = await fetch(`http://127.0.0.1:${endpoint.port}/tool`, {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "trigger_component",
      arguments: { componentId: matchingId, triggerId: matchingRules[0].id, agentId },
    }),
  });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Automatic component triggers are disabled/);
  assert.equal((await library()).instances.filter(instance => instance.agentId === agentId).length, 1);
  checks.push(
    "Installer disabled automatic triggers through UI; direct authenticated tool call rejected without a model turn or extra instance",
  );
  await restoreSettings();
  assert.deepEqual((await studio()).current.colors, before.current.colors);
  assert.deepEqual((await studio()).active, before.active);
  assert.deepEqual(await Promise.all(mainFiles.map(hash)), mainBefore);
  assert.deepEqual(errors, []);
  const evidence = {
    checks,
    userTask,
    agentId,
    instanceId: instance.id,
    matchingId,
    nonmatchingId,
    trigger: instance.trigger,
    chatUrl,
    state: instance.state,
    errors,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    mainFilesUnchanged: true,
    paletteAndActiveUnchanged: true,
    isolatedSettingsRestored: true,
  };
  await writeFile(join(output, "component-triggers-qa.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, "component-triggers-error.png") }).catch(() => {});
  await writeFile(
    join(output, "component-triggers-error.json"),
    JSON.stringify(
      {
        message: error.message,
        checks,
        agentId,
        matchingId,
        nonmatchingId,
        userTask,
        mainBefore,
        before,
        initialConnection,
        errors,
        url: page.url(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await restoreSettings().catch(error =>
    console.error("Could not restore isolated installer settings:", error.message),
  );
  await browser.close();
}
