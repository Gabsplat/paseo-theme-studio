// Continue the isolated trigger QA once, after synchronizing the final source.
// Requires the idle agent and evidence created by qa-component-triggers.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const root = "/home/gabsplat/Labs/theme-studio-components-qa";
const home = process.env.PASEO_QA_HOME || join(root, "home");
const origin = process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:7789";
assert.equal(origin, "http://127.0.0.1:7789");
assert.equal(await realpath(home), join(root, "home"));
assert.equal(await realpath(join(root, "plugin")), join(root, "plugin"));
const output = resolve("output");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const initial = await json(join(output, "component-triggers-qa.json"));
assert.ok(initial.chatUrl.startsWith(`${origin}/`));
const library = () => json(join(home, "theme-studio/components.json"));
const studio = () => json(join(home, "theme-studio/studio.json"));
const mainFiles = [
  "/home/gabsplat/.paseo/theme-studio/studio.json",
  "/home/gabsplat/.paseo/theme-studio/designer.json",
  "/home/gabsplat/.paseo/theme-studio/agent-connection.json",
  "/home/gabsplat/Programming/theme-creator/client/generated-components.tsx",
];
const hash = async file => {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const mainBefore = await Promise.all(mainFiles.map(hash));
const studioBefore = await studio();
const before = await library();
const old = before.instances.find(instance => instance.id === initial.instanceId);
assert.ok(old);
assert.equal(old.agentId, initial.agentId);
assert.equal(
  before.instances.filter(instance => instance.agentId === initial.agentId).length,
  1,
  "This continuation is intentionally single-use.",
);
const cli = promisify(execFile);
const args = ["--host", "127.0.0.1:7789"];
const inspect = async () =>
  JSON.parse((await cli("paseo", [...args, "inspect", initial.agentId, "--json"], { maxBuffer: 1000000 })).stdout);
assert.equal((await inspect()).Status, "idle");
const reload = JSON.parse(
  (await cli("paseo", [...args, "agent", "reload", initial.agentId, "--json"], { timeout: 60000, maxBuffer: 1000000 }))
    .stdout,
);
assert.equal(reload.status, "reloaded");
assert.ok(reload.timelineSize > 0);
const userTask =
  "Now adapt the same bakery home-delivery launch plan for a rainy week. Keep it to three practical steps for reaching nearby customers and delivering reliably. Do not ask me questions.";
assert.doesNotMatch(userTask, /theme\s?studio|component|widget|\btool\b|\bmcp\b/i);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PASEO_QA_CHROMIUM ? { executablePath: process.env.PASEO_QA_CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.getByText("Theme Studio", { exact: true }).first().waitFor();
  await page.goto(initial.chatUrl);
  const composer = page.getByPlaceholder("Message the agent, tag @files, or use /commands and /skills");
  await composer.waitFor({ timeout: 30000 });
  await composer.fill(userTask);
  await composer.press("Enter");
  console.log(
    JSON.stringify({
      stage: "Real ordinary followup after public provider reload",
      agentId: initial.agentId,
      historyPreserved: reload.timelineSize,
    }),
  );
  const deadline = Date.now() + 300000;
  let nextReport = Date.now() + 10000;
  let current;
  while (Date.now() < deadline) {
    current = await library();
    const owned = current.instances.filter(instance => instance.agentId === initial.agentId);
    const status = await inspect();
    if (owned.length === 2 && status.Status === "idle") break;
    if (Date.now() >= nextReport) {
      console.log(
        JSON.stringify({ stage: "Waiting for reloaded provider turn", status: status.Status, instances: owned.length }),
      );
      nextReport += 10000;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  assert.equal((await inspect()).Status, "idle");
  current = await library();
  const owned = current.instances.filter(instance => instance.agentId === initial.agentId);
  assert.equal(owned.length, 2);
  const latest = owned.find(instance => instance.id !== old.id);
  assert.equal(latest.componentId, initial.matchingId);
  assert.equal(latest.trigger.turnId, old.trigger.turnId, "The real provider recycled its raw turn ID.");
  assert.ok(latest.trigger.turnStartedAt, "New provenance includes the actual public native turn start.");
  assert.notEqual(latest.trigger.turnStartedAt, old.trigger.turnStartedAt);
  assert.deepEqual(
    owned.find(instance => instance.id === old.id),
    old,
    "New turn must preserve the old instance and its state.",
  );
  assert.ok(!owned.some(instance => instance.componentId === initial.nonmatchingId));
  await page.reload();
  await page.getByText("Delivery launch progress", { exact: true }).last().waitFor({ timeout: 30000 });
  assert.equal(await page.getByText("Delivery launch progress", { exact: true }).count(), 2);
  await page.getByText("Delivery launch progress", { exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "component-triggers-reload-native-chat.png") });
  const logs = (
    await cli("paseo", [...args, "logs", initial.agentId, "--tail", "200", "--json"], { maxBuffer: 8000000 })
  ).stdout;
  await writeFile(join(output, "component-triggers-reload-timeline.json"), logs);
  assert.deepEqual((await studio()).current.colors, studioBefore.current.colors);
  assert.deepEqual((await studio()).active, studioBefore.active);
  assert.deepEqual(await Promise.all(mainFiles.map(hash)), mainBefore);
  assert.deepEqual(errors, []);
  const evidence = {
    userTask,
    agentId: initial.agentId,
    historyPreserved: reload.timelineSize,
    instances: owned.map(instance => ({ id: instance.id, trigger: instance.trigger, state: instance.state })),
    rawTurnIdRecycled: true,
    oldInstanceUnchanged: true,
    nativeRowsPersisted: 2,
    nonmatchingInstances: 0,
    mainFilesUnchanged: true,
    paletteAndActiveUnchanged: true,
    errors,
  };
  await writeFile(join(output, "component-triggers-reload-qa.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, "component-triggers-reload-error.png") }).catch(() => {});
  await writeFile(
    join(output, "component-triggers-reload-error.json"),
    JSON.stringify({ message: error.message, url: page.url(), errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
