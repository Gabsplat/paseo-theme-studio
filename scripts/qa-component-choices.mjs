// Run after the isolated Labs daemon has the latest copied plugin source.
// PASEO_QA_ORIGIN=http://127.0.0.1:7789 PASEO_QA_HOME=/home/gabsplat/Labs/theme-studio-components-qa/home pnpm exec node scripts/qa-component-choices.mjs
// Uses the native opt-in UI, a normal general agent, and one real choice turn.
// PASEO_QA_CHOICES_RESUME=output/component-choices-resume.json continues after publication.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
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
const cli = promisify(execFile);
const qaCliEnvironment = { ...process.env };
delete qaCliEnvironment.PASEO_AGENT_ID;
delete qaCliEnvironment.PASEO_WORKSPACE_ID;
const host = "127.0.0.1:7789";
const output = resolve("output");
await mkdir(output, { recursive: true });
const resumed = process.env.PASEO_QA_CHOICES_RESUME
  ? JSON.parse(await readFile(process.env.PASEO_QA_CHOICES_RESUME, "utf8"))
  : null;
const json = async file => JSON.parse(await readFile(file, "utf8"));
const studio = () => json(join(home, "theme-studio/studio.json"));
const library = async () => {
  try {
    return await json(join(home, "theme-studio/components.json"));
  } catch (e) {
    if (e.code === "ENOENT") return { definitions: [], instances: [] };
    throw e;
  }
};
const connection = async () => {
  try {
    return await json(join(home, "theme-studio/agent-connection.json"));
  } catch (e) {
    if (e.code === "ENOENT") return { revision: 0, enabled: false };
    throw e;
  }
};
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
const mainBefore = resumed?.mainBefore ?? (await Promise.all(mainFiles.map(hash)));
const runId = resumed?.runId ?? resumed?.componentId?.replace("qa-choice-", "") ?? Date.now().toString(36);
const componentId = `qa-choice-${runId}`;
const title = `QA general choices ${runId}`;
const cwd = join(root, `general-${runId}`);
await mkdir(cwd, { recursive: true });
const tree = {
  type: "stack",
  gap: 10,
  children: [
    { type: "text", text: "What should we do next?" },
    {
      type: "row",
      children: [
        { type: "button", label: "Research options", action: "choose", value: "research" },
        { type: "button", label: "Compare options", action: "choose", value: "compare" },
        { type: "button", label: "Summarize options", action: "choose", value: "summarize" },
      ],
    },
    { type: "input", label: "Choice note", stateKey: "note", action: "note-submit" },
    { type: "stat", label: "Progress", value: "Choose an option", stateKey: "feedback" },
    { type: "stat", label: "Decision", value: "Waiting for your choice", stateKey: "result" },
  ],
};
const prompt = `Use ONLY the theme-studio MCP tools to offer me three next-step choices in this native conversation. Do not edit files, use shell tools, activate anything, or change any palette. Read current capabilities and the library. Create a composition id ${componentId}, name "Three next steps", exact tree ${JSON.stringify(tree)}. Read the current library revision before each mutation. Try publishing it with state {processing:false,feedback:"Choose an option",result:"Waiting for your choice",note:""}. Deliberately OMIT agentId from publish_component to test the session owner context. If owner context is unavailable, stop after that error and ask for the target agent ID; do not guess an ID or use the dedicated designer or another agent. Stop when published or after the missing-owner error.
For future choose actions, interpret the selected value as the user's requested next step. Read the current instance, preserve its fields and note, then update state with processing:true and feedback:"Considering your choice" using latest INSTANCE revision. Next read again and finish with processing:false, feedback:"Decision ready", and result string "Compare selected" for compare (or an appropriate result for the other two). Return the outcome inside the component; do not post a separate chat confirmation or tool-routing narration. A note change only saves input, and must not run the model. Handle this test's choice exactly once.`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PASEO_QA_CHROMIUM ? { executablePath: process.env.PASEO_QA_CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const checks = resumed?.checks ?? [];
let agentId = resumed?.agentId,
  instanceId,
  studioUrl,
  before,
  started;
let enabledByTest = false;
const processingStates = new Set();
async function until(label, predicate, limit = 20000) {
  const deadline = Date.now() + limit;
  let nextLog = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (Date.now() >= nextLog) {
      console.log(JSON.stringify({ stage: `Waiting for ${label}`, agentId }));
      nextLog += 10000;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
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
async function waitIdle() {
  await until(
    "general agent idle",
    async () =>
      JSON.parse((await cli("paseo", ["--host", host, "inspect", agentId, "--json"], { maxBuffer: 1000000 })).stdout)
        .Status === "idle",
    300000,
  );
}
try {
  assert.equal((await connection()).enabled, false, "QA must begin with automatic connections off.");
  await page.goto(origin);
  await page.getByText("Theme Studio", { exact: true }).first().click();
  await page.getByTestId("theme-studio").waitFor();
  studioUrl = page.url();
  before = resumed?.before ?? (await studio());
  await openLibrary();
  await page.getByRole("button", { name: "Connect new agents", exact: true }).click();
  enabledByTest = true;
  await until("UI opt-in persistence", async () => (await connection()).enabled);
  await page.reload();
  await openLibrary();
  await page.getByRole("button", { name: "Disconnect new agents", exact: true }).waitFor();
  if (!checks.includes("MCP connection began off and was enabled explicitly through native UI"))
    checks.push("MCP connection began off and was enabled explicitly through native UI");
  checks.push("Isolated opt-in remained enabled after browser reload");
  await page.screenshot({ path: join(output, "component-choices-opt-in.png") });
  started = Date.now();
  if (!resumed) {
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
            prompt,
          ],
          { env: qaCliEnvironment, timeout: 60000, maxBuffer: 2000000 },
        )
      ).stdout,
    );
    agentId = run.agentId;
  }
  assert.match(agentId, /^[0-9a-f-]{36}$/i);
  console.log(
    JSON.stringify({
      stage: resumed
        ? "Resuming the existing general agent without generating again"
        : "Normal general agent created after UI opt-in",
      agentId,
    }),
  );
  await until(
    "real general-agent composition creation",
    async () => (await library()).definitions.some(i => i.id === componentId),
    300000,
  );
  await waitIdle();
  const workspaces = JSON.parse(
    (await cli("paseo", ["--host", host, "workspace", "ls", "--json"], { maxBuffer: 2000000 })).stdout,
  );
  const entries = Array.isArray(workspaces) ? workspaces : (workspaces.entries ?? workspaces.data);
  const workspace = entries.find(w => (w.cwd ?? w.Cwd) === cwd);
  assert.ok(workspace, "General agent workspace must appear in public workspace listing.");
  const { serverId } = await json(join(home, "paseo.pid"));
  const chatUrl = `${origin}/h/${serverId}/workspace/${workspace.workspaceId ?? workspace.id ?? workspace.Id}`;
  await page.goto(chatUrl);
  let instance = (await library()).instances.find(i => i.componentId === componentId);
  if (!instance) {
    const denied = (
      await cli("paseo", ["--host", host, "logs", agentId, "--tail", "100", "--json"], { maxBuffer: 6000000 })
    ).stdout;
    assert.match(denied, /Specify target agentId; owner context unavailable/);
    checks.push("Missing provider owner context rejected publication instead of routing to the dedicated designer");
    const composer = page.getByPlaceholder("Message the agent, tag @files, or use /commands and /skills");
    await composer.fill(
      `The exact target for this native conversation is agentId ${agentId}. Read the current library and publish the saved composition ${componentId} to that explicit agentId with state {processing:false,feedback:"Choose an option",result:"Waiting for your choice",note:""}. Keep the previously described choice behavior. Do not create a duplicate component or change any palette. Stop when published.`,
    );
    await composer.press("Enter");
    await until(
      "explicit publication to the general agent",
      async () => (await library()).instances.some(i => i.componentId === componentId),
      300000,
    );
    await waitIdle();
    instance = (await library()).instances.find(i => i.componentId === componentId);
  } else {
    const ownerDirectory = join(home, "theme-studio/agent-owners");
    const bindings = await Promise.all(
      (await readdir(ownerDirectory))
        .filter(name => name.endsWith(".json"))
        .map(name => json(join(ownerDirectory, name))),
    );
    assert.ok(
      bindings.some(binding => binding.agentId === agentId),
      "Implicit publication must have its persisted public-hook owner binding.",
    );
    checks.push("Persisted public-hook owner context published implicitly into the correct general-agent conversation");
  }
  instanceId = instance.id;
  assert.equal(instance.agentId, agentId, "Publication must belong to the actual general agent, never the designer.");
  assert.equal((await studio()).designerAgentId, before.designerAgentId);
  checks.push("Normal general agent received MCP through opt-in creation hook and published into its own conversation");
  await writeFile(
    join(output, "component-choices-resume.json"),
    JSON.stringify({ runId, agentId, componentId, checks, mainBefore, before }, null, 2),
  );
  await page.getByRole("button", { name: "Compare options", exact: true }).waitFor({ timeout: 60000 });
  const note = page.getByRole("textbox", { name: "Choice note", exact: true });
  await note.fill("Retain my input while deciding.");
  await until(
    "state-only choice note",
    async () =>
      (await library()).instances.find(i => i.id === instanceId).state.note === "Retain my input while deciding.",
  );
  const typed = (await library()).instances.find(i => i.id === instanceId);
  assert.ok(typed.events.every(e => e.action.action === "__state__" && e.dispatchedAt));
  await waitIdle();
  checks.push("Input persisted without a model action or domain decision");
  await page.getByRole("button", { name: "Compare options", exact: true }).click();
  await until(
    "real processing and selected result",
    async () => {
      const current = (await library()).instances.find(i => i.id === instanceId);
      processingStates.add(current.state.processing);
      return current.state.result === "Compare selected" && current.state.processing === false;
    },
    300000,
  );
  await waitIdle();
  await page.getByText("Compare selected", { exact: true }).waitFor();
  await until(
    "verified interaction row hidden",
    async () => !(await page.locator("body").innerText()).includes("studio.component-interaction"),
  );
  const final = (await library()).instances.find(i => i.id === instanceId);
  assert.equal(final.state.note, "Retain my input while deciding.");
  assert.equal(final.events.filter(e => e.action.action === "choose").length, 1);
  assert.ok(final.events.find(e => e.action.action === "choose").dispatchedAt);
  assert.ok(processingStates.has(true), "The actual agent must produce processing feedback before its result.");
  assert.ok(
    !(await page.locator("body").innerText()).includes("The user explicitly interacted with a Theme Studio component."),
  );
  await page.getByRole("button", { name: "Compare options", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "component-choices-result.png") });
  checks.push(
    "One choice routed to the real owner; processing and decision returned inside the component with technical event hidden",
  );
  await page.reload();
  await page.getByText("Compare selected", { exact: true }).waitFor({ timeout: 60000 });
  await until(
    "verified persisted interaction hidden after browser reload",
    async () => !(await page.locator("body").innerText()).includes("studio.component-interaction"),
  );
  checks.push("Result and hidden interaction persisted after browser reload");
  const logs = (
    await cli("paseo", ["--host", host, "logs", agentId, "--tail", "150", "--json"], { maxBuffer: 6000000 })
  ).stdout;
  assert.match(logs, /studio\.component-interaction/);
  assert.match(logs, new RegExp(final.events.find(e => e.action.action === "choose").id));
  await writeFile(join(output, "component-choices-agent-timeline.json"), logs);
  assert.deepEqual((await studio()).current.colors, before.current.colors);
  assert.deepEqual((await studio()).active, before.active);
  await openLibrary();
  await page.getByRole("button", { name: "Set up an existing agent", exact: true }).click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy MCP configuration", exact: true }).click();
  await page.getByRole("button", { name: "Configuration copied", exact: true }).waitFor();
  checks.push("Codex existing-agent MCP setup copied through UI without changing provider configuration");
  await page.getByRole("button", { name: "Disconnect new agents", exact: true }).click();
  await until("QA opt-in restored off", async () => !(await connection()).enabled);
  enabledByTest = false;
  await page.reload();
  await openLibrary();
  await page.getByRole("button", { name: "Connect new agents", exact: true }).waitFor();
  await page.setViewportSize({ width: 430, height: 932 });
  await openLibrary();
  await page.getByRole("button", { name: "Connect new agents", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "component-choices-compact.png") });
  checks.push("Connection restored off, retained after reload, and checked at compact width");
  assert.deepEqual(await Promise.all(mainFiles.map(hash)), mainBefore);
  assert.deepEqual(errors, []);
  const evidence = {
    checks,
    agentId,
    instanceId,
    componentId,
    chatUrl,
    processingStates: [...processingStates],
    errors,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    resumed: Boolean(resumed),
    paletteAndActiveUnchanged: true,
    mainFilesUnchanged: true,
    optInRestoredOff: true,
  };
  await writeFile(join(output, "component-choices-qa.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, "component-choices-error.png") }).catch(() => {});
  await writeFile(
    join(output, "component-choices-error.json"),
    JSON.stringify(
      {
        message: error.message,
        checks,
        agentId,
        instanceId,
        componentId,
        errors,
        mainBefore,
        before,
        processingStates: [...processingStates],
        url: page.url(),
        enabledByTest,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  // Restore only this test's isolated opt-in setting through its UI, even on failure.
  if (enabledByTest && studioUrl) {
    await openLibrary()
      .then(async () => {
        await page.getByRole("button", { name: "Disconnect new agents", exact: true }).click();
        await until("restore isolated opt-in", async () => !(await connection()).enabled);
      })
      .catch(error => console.error("Could not restore isolated UI opt-in:", error.message));
  }
  await browser.close();
}
