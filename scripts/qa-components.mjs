// Run only after preparing the isolated Labs daemon and copied plugin source.
// PASEO_QA_ORIGIN=http://127.0.0.1:7789 \
// PASEO_QA_HOME=/home/gabsplat/Labs/theme-studio-components-qa/home \
// pnpm exec node scripts/qa-components.mjs
// This test sends real model requests through native chat and component buttons.
// To continue a failed run after generation without generating again, set
// PASEO_QA_RESUME=output/components-qa-resume.json.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const origin = process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:7789";
const qaHome = process.env.PASEO_QA_HOME || "/home/gabsplat/Labs/theme-studio-components-qa/home";
const isolatedRoot = "/home/gabsplat/Labs/theme-studio-components-qa";
assert.equal(origin, "http://127.0.0.1:7789", "Component QA is restricted to the isolated port.");
assert.equal(resolve(qaHome), join(isolatedRoot, "home"), "Component QA must use its isolated Labs home.");
assert.equal(await realpath(qaHome), resolve(qaHome), "The isolated home must not redirect through a symlink.");
const output = resolve("output");
await mkdir(output, { recursive: true });
const resumed = process.env.PASEO_QA_RESUME ? JSON.parse(await readFile(process.env.PASEO_QA_RESUME, "utf8")) : null;
const cli = promisify(execFile);
const host = "127.0.0.1:7789";
const studio = async () => JSON.parse(await readFile(join(qaHome, "theme-studio/studio.json"), "utf8"));
const library = async () => {
  try {
    return JSON.parse(await readFile(join(qaHome, "theme-studio/components.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { definitions: [], instances: [], favorites: [], builds: [], activeKeys: [] };
    throw error;
  }
};
const fingerprint = async path => {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const mainPaths = [
  "/home/gabsplat/.paseo/theme-studio/studio.json",
  "/home/gabsplat/.paseo/theme-studio/designer.json",
  "/home/gabsplat/Programming/theme-creator/client/generated-components.tsx",
];
const mainBefore = resumed?.mainBefore ?? (await Promise.all(mainPaths.map(fingerprint)));
let before = resumed?.before;
const runId = resumed?.runId ?? Date.now().toString(36);
const compositionId = `qa-tree-${runId}`;
const codeId = `qa-code-${runId}`;
const compositionName = `QA composition ${runId}`;
const codeName = `QA generated ${runId}`;
const packName = `QA favorite ${runId}`;
const compositionButton = "Increment composition counter";
const codeButton = "Increment generated counter";
const tree = {
  type: "stack",
  gap: 12,
  children: [
    { type: "text", text: "QA composition counter", size: 18 },
    { type: "stat", label: "QA composition count", value: "0", stateKey: "count" },
    { type: "input", label: "QA counter note", stateKey: "note", action: "note-submit" },
    { type: "button", label: compositionButton, action: "increment" },
  ],
};
const prompt = `This is an isolated real Theme Studio component QA task. Use ONLY the theme-studio MCP tools. Do not edit source files directly, use shell tools, alter the theme/draft/active palette, or activate anything.
First read capabilities and list_components. Create exactly this composition with create_composition: id=${compositionId}, name=${JSON.stringify(compositionName)}, tree=${JSON.stringify(tree)}. Read the current LIBRARY revision before each library mutation.
Then create a React Native TSX code component with create_code_component: id=${codeId}, name=${JSON.stringify(codeName)}. It must default-export a component accepting ComponentProps imported as type from ../../shared/components. Use View, Text, and Pressable from react-native. The root View must have testID="qa-generated-counter". Show title "QA generated counter" and the text "Generated count: N" where N is Number(state.count ?? 0). Include a native accessible button named exactly ${JSON.stringify(codeButton)} that calls onAction({ action: "increment" }). Its text must use the theme accentForeground and its background theme accent. Other text/background colors must come from theme.colors. Do not compute or patch the next count in the button, use useState for count, or mutate state locally.
Call build_components with the latest LIBRARY revision after saving both. Stop after its successful typecheck; I will activate the generated code and publish both through the UI. Do not call publish_component now.
Remember the domain behavior for later component-interaction events in this same conversation: for either component ID above, action "increment" means read_component_instance, then update_component_state with the latest INSTANCE expectedRevision and state { ...currentState, count: Number(currentState.count ?? 0) + 1 }. Increment exactly once per explicit event, preserve note and other fields, and do not perform any theme action. Action __state__ is input-only and must never start a model turn. Briefly confirm when ready.`;

const checks = resumed?.checks ?? [];
let page;
let session = resumed?.session;
let chatUrl = resumed?.chatUrl;
let generationStarted = resumed?.generationStarted;
let saved = resumed?.saved;
const errors = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PASEO_QA_CHROMIUM ? { executablePath: process.env.PASEO_QA_CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
page.on("pageerror", error => errors.push(error.message));
const report = stage =>
  console.log(
    JSON.stringify({
      stage,
      elapsedSeconds: generationStarted ? Math.round((Date.now() - generationStarted) / 1000) : 0,
    }),
  );
async function until(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let nextReport = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (Date.now() >= nextReport) {
      report(`Waiting for ${label}`);
      nextReport += 10000;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function assertPaletteUnchanged(label) {
  const current = await studio();
  assert.deepEqual(current.current.colors, before.current.colors, `${label}: draft palette changed.`);
  assert.deepEqual(current.active, before.active, `${label}: active pack changed.`);
}
async function openLibrary() {
  if (!(await page.getByTestId("theme-studio").filter({ visible: true }).count())) {
    await page.getByText("Theme Studio", { exact: true }).first().click();
  }
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
async function waitAgentIdle(timeoutSeconds = 300) {
  await cli("paseo", ["--host", host, "wait", session.agentId, "--timeout", String(timeoutSeconds), "--json"], {
    timeout: timeoutSeconds * 1000 + 5000,
    maxBuffer: 2000000,
  });
}
async function publish(name, id) {
  await openLibrary();
  const surface = page.getByTestId("component-library").filter({ visible: true }).last();
  await surface.getByRole("textbox", { name: "Search components", exact: true }).fill(id);
  await surface.getByText(name, { exact: true }).waitFor();
  await surface.getByRole("button", { name: "Use in agent", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Target agent ID", exact: true }).fill(session.agentId);
  await page
    .getByRole("textbox", { name: "Component initial state JSON", exact: true })
    .fill(JSON.stringify({ count: 0, note: "" }));
  const latest = page.getByRole("button", { name: "Use latest library revision", exact: true });
  await page.waitForTimeout(900);
  if (await latest.isVisible()) await latest.click();
  await page.getByRole("button", { name: "Publish to agent", exact: true }).click();
  await until(`publication of ${id}`, async () =>
    (await library()).instances.some(instance => instance.componentId === id),
  );
  await page.waitForURL(/\/workspace\//);
  const instance = (await library()).instances.find(instance => instance.componentId === id);
  assert.equal(instance.agentId, session.agentId);
  return instance;
}
async function increment(instanceId, button) {
  await waitAgentIdle();
  await page.getByRole("button", { name: button, exact: true }).scrollIntoViewIfNeeded();
  const beforeInstance = (await library()).instances.find(instance => instance.id === instanceId);
  const startedAt = Date.now();
  await page.getByRole("button", { name: button, exact: true }).click();
  await until(`persisted user action for ${button}`, async () =>
    (await library()).instances
      .find(instance => instance.id === instanceId)
      .events.some(event => event.action.action === "increment"),
  );
  const queued = (await library()).instances.find(instance => instance.id === instanceId);
  const event = queued.events.find(event => event.action.action === "increment");
  assert.equal(event.action.patch?.count, undefined, "The click must not calculate the result locally.");
  assert.equal(event.state.count, beforeInstance.state.count, "The event snapshot must retain the pre-agent count.");
  await until(
    `real agent result for ${button}`,
    async () => {
      const current = (await library()).instances.find(instance => instance.id === instanceId);
      return (
        current.state.count === beforeInstance.state.count + 1 &&
        current.events.some(value => value.id === event.id && value.dispatchedAt)
      );
    },
    300000,
  );
  await waitAgentIdle(Math.max(1, 300 - Math.ceil((Date.now() - startedAt) / 1000)));
  checks.push(`${button}: explicit native action routed to real agent and structured result persisted`);
  await assertPaletteUnchanged(button);
  return (await library()).instances.find(instance => instance.id === instanceId);
}

try {
  report("Starting isolated native UI QA");
  if (!resumed) {
    await page.goto(origin);
    await page.getByText("Theme Studio", { exact: true }).first().click();
    const studioUrl = page.url();
    let surface = page.getByTestId("theme-studio");
    await surface.waitFor();
    await until("initial studio persistence", async () => {
      try {
        before = await studio();
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    });
    await surface.getByRole("button", { name: "Save pack", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Pack name", exact: true }).fill(packName);
    await page.getByRole("button", { name: "Save to library", exact: true }).click();
    await until("saved QA theme", async () => (await studio()).saved.some(theme => theme.name === packName));
    await surface.getByRole("tab", { name: "Packs", exact: true }).click();
    await surface.getByRole("button", { name: `Favorite ${packName}`, exact: true }).click();
    saved = (await studio()).saved.find(theme => theme.name === packName);
    await until("persisted favorite", async () => (await studio()).favorites.includes(saved.id));
    await surface.getByRole("button", { name: "Favorites only", exact: true }).click();
    await surface.getByRole("button", { name: `Load ${packName}`, exact: true }).waitFor();
    await surface.getByRole("button", { name: `Load ${packName}`, exact: true }).click();
    await assertPaletteUnchanged("Save, favorite, filter, and load");
    await page.reload();
    await page.getByTestId("theme-studio").getByRole("tab", { name: "Packs", exact: true }).click();
    await page.getByRole("button", { name: `Unfavorite ${packName}`, exact: true }).waitFor();
    checks.push("Theme saved, starred, filtered, reloaded into draft, and retained after browser reload");
    await page.screenshot({ path: join(output, "theme-studio-components-favorites.png") });

    await page.goto(studioUrl);
    surface = page.getByTestId("theme-studio");
    await surface.waitFor();
    const current = await studio();
    const startTitle = current.designerAgentId ? "Designer" : "Start designer";
    await surface.getByRole("button", { name: startTitle, exact: true }).first().click();
    await page.waitForURL(/\/workspace\//, { timeout: 60000 });
    const started = await studio();
    session = { agentId: started.designerAgentId, workspaceId: started.designerWorkspaceId };
    assert.ok(session.agentId);
    chatUrl = page.url();
    const inspection = JSON.parse(
      (await cli("paseo", ["--host", host, "inspect", session.agentId, "--json"], { maxBuffer: 2000000 })).stdout,
    );
    assert.match(JSON.stringify(inspection), /gpt-6\.1-sol/);
    assert.match(JSON.stringify(inspection), /high/);
    checks.push("Native default GPT-6.1 Sol high designer created or reopened");
    const composer = page.getByPlaceholder("Message the agent, tag @files, or use /commands and /skills");
    await composer.waitFor({ timeout: 60000 });
    await composer.fill(prompt);
    generationStarted = Date.now();
    await composer.press("Enter");
    report("Real designer is generating both reusable components through MCP");
    await until(
      "model composition, code component, and successful build",
      async () => {
        const current = await library();
        const composition = current.definitions.find(definition => definition.id === compositionId);
        const code = current.definitions.find(definition => definition.id === codeId);
        return (
          composition?.mode === "composition" &&
          code?.mode === "code" &&
          current.builds.some(build => build.typecheck && build.keys.includes(`${codeId}@${code.version}`))
        );
      },
      300000,
    );
    await waitAgentIdle(Math.max(1, 300 - Math.ceil((Date.now() - generationStarted) / 1000)));
    const generated = await library();
    const composition = generated.definitions.find(definition => definition.id === compositionId);
    const code = generated.definitions.find(definition => definition.id === codeId);
    assert.deepEqual(composition.tree, tree);
    assert.doesNotMatch(code.code, /\buseState\b|\bsetCount\b/);
    assert.ok(
      !generated.activeKeys.includes(`${codeId}@${code.version}`),
      "The model must not activate generated code.",
    );
    await assertPaletteUnchanged("Model component generation");
    checks.push("Real MCP composition and native TSX generated, source typechecked, and left awaiting user activation");
    await page.screenshot({ path: join(output, "theme-studio-components-agent-generated.png") });
    await writeFile(
      join(output, "components-qa-resume.json"),
      JSON.stringify({ runId, before, mainBefore, checks, session, chatUrl, generationStarted, saved }, null, 2),
    );
  } else {
    await page.goto(chatUrl);
    report("Resuming existing real-model components and native designer");
  }

  await openLibrary();
  const code = (await library()).definitions.find(definition => definition.id === codeId);
  if (!(await library()).activeKeys.includes(`${codeId}@${code.version}`)) {
    const surface = page.getByTestId("component-library").filter({ visible: true }).last();
    await surface.getByRole("button", { name: "Activate components", exact: true }).click();
    // Activation now requires confirming the source review.
    await surface.getByRole("button", { name: "I reviewed this code · Activate", exact: true }).click();
  }
  await until("manual component activation", async () =>
    (await library()).activeKeys.includes(`${codeId}@${code.version}`),
  );
  await page.getByTestId("component-library").filter({ visible: true }).last().waitFor({ timeout: 60000 });
  await page.reload();
  await page.getByTestId("component-library").filter({ visible: true }).last().waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(output, "theme-studio-components-library.png") });
  if (!checks.includes("Generated code activated explicitly through the native library UI"))
    checks.push("Generated code activated explicitly through the native library UI");

  const compositionInstance = await publish(compositionName, compositionId);
  await page.getByRole("button", { name: compositionButton, exact: true }).waitFor();
  const note = page.getByRole("textbox", { name: "QA counter note", exact: true });
  await note.fill("Native input stays input until a button submits.");
  await until(
    "state-only native input",
    async () =>
      (await library()).instances.find(instance => instance.id === compositionInstance.id).state.note ===
      "Native input stays input until a button submits.",
  );
  const typed = (await library()).instances.find(instance => instance.id === compositionInstance.id);
  assert.equal(typed.state.count, 0);
  assert.ok(typed.events.every(event => event.action.action === "__state__" && event.dispatchedAt));
  checks.push("Composition input persisted with no domain result or component-submit event");
  const codeInstance = await publish(codeName, codeId);
  await page.getByTestId("qa-generated-counter").waitFor();
  await page.screenshot({ path: join(output, "theme-studio-components-native-chat.png") });
  checks.push("Both component modes published as actual native chat timeline rows");

  await increment(codeInstance.id, codeButton);
  await page.getByTestId("qa-generated-counter").getByText("Generated count: 1", { exact: true }).waitFor();
  await increment(compositionInstance.id, compositionButton);
  await page.getByText("QA composition count", { exact: true }).locator("..").getByText("1", { exact: true }).waitFor();
  await page.getByTestId("qa-generated-counter").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "theme-studio-components-agent-results.png") });
  await page.reload();
  await page.getByRole("button", { name: codeButton, exact: true }).waitFor({ timeout: 60000 });
  const final = await library();
  assert.equal(final.instances.find(instance => instance.id === codeInstance.id).state.count, 1);
  assert.equal(final.instances.find(instance => instance.id === compositionInstance.id).state.count, 1);
  checks.push("Agent-produced component state retained after browser reload");
  const logs = (
    await cli("paseo", ["--host", host, "logs", session.agentId, "--tail", "150", "--json"], { maxBuffer: 6000000 })
  ).stdout;
  for (const tool of [
    "create_composition",
    "create_code_component",
    "build_components",
    "read_component_instance",
    "update_component_state",
  ])
    assert.match(logs, new RegExp(tool));
  await writeFile(join(output, "component-agent-timeline.json"), logs);
  assert.deepEqual(
    await Promise.all(mainPaths.map(fingerprint)),
    mainBefore,
    "The main studio, live designer, and generated registry must remain untouched.",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const evidence = {
    checks,
    session,
    chatUrl,
    compositionId,
    codeId,
    instanceIds: [compositionInstance.id, codeInstance.id],
    favoriteThemeId: saved.id,
    errors,
    modelDurationSeconds: generationStarted ? Math.round((Date.now() - generationStarted) / 1000) : null,
    resumed: Boolean(resumed),
    mainStateUnchanged: true,
    paletteAndActiveUnchanged: true,
  };
  await writeFile(join(output, "components-qa.json"), JSON.stringify(evidence, null, 2));
  report("All isolated real-model component QA checks passed");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, "theme-studio-components-error.png") }).catch(() => {});
  const failure = {
    message: error.message,
    session,
    chatUrl,
    url: page.url(),
    checks,
    errors,
    alerts: await page
      .getByRole("alert")
      .allTextContents()
      .catch(() => []),
    mainStateUnchanged: JSON.stringify(await Promise.all(mainPaths.map(fingerprint))) === JSON.stringify(mainBefore),
  };
  await writeFile(join(output, "components-qa-error.json"), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  throw error;
} finally {
  await browser.close();
}
