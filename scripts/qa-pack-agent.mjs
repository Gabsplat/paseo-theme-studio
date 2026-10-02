import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const origin = process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:7789";
const qaHome = process.env.PASEO_QA_HOME || "/tmp/theme-studio-pack-qa";
assert.equal(origin, "http://127.0.0.1:7789", "This agent test is restricted to the isolated QA daemon.");
assert.equal(qaHome, "/tmp/theme-studio-pack-qa", "This agent test must not use the main daemon home.");
const host = "127.0.0.1:7789";
const cli = promisify(execFile);
const state = async () => JSON.parse(await readFile(`${qaHome}/theme-studio/studio.json`, "utf8"));
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
  `${process.env.HOME}/.paseo/theme-studio/studio.json`,
  `${process.env.HOME}/.paseo/theme-studio/designer.json`,
  `${process.env.HOME}/.paseo/config.json`,
];
const mainBefore = await Promise.all(mainPaths.map(fingerprint));
const isolatedConfigBefore = await fingerprint(`${qaHome}/config.json`);
const before = await state();
assert.equal(before.designerAgentId, null, "QA must start with a fresh isolated designer session.");
const panel = {
  enabled: true,
  title: "Agent generated",
  icon: "BookOpen",
  blocks: [
    { type: "text", text: "Prepared by the isolated designer." },
    { type: "stat", label: "Checks", value: "4" },
    { type: "list", title: "Next", items: ["Review preview", "Activate manually"] },
    { type: "progress", label: "Ready", value: 75 },
  ],
};
const prompt = `This is an isolated Theme Studio QA check. Use ONLY the theme-studio MCP tools. First call read_theme. Then call patch_theme using expectedRevision from that read to change ONLY ui.radius to 14 and ui.panel to exactly ${JSON.stringify(panel)}. Preserve all other UI settings and all palette colors. Do not activate, save, change locks, edit files, or use shell commands. Do not use patch_pack for this check; specifically exercise the backward-compatible patch_theme UI API. Then call read_theme again and briefly confirm that the draft has radius 14 and the four panel block types, while active remains unchanged. No unrelated tools.`;

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PASEO_QA_CHROMIUM || "/home/gabsplat/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let session;
try {
  await page.goto(origin);
  await page.getByText("Theme Studio", { exact: true }).first().click();
  const studio = page.getByTestId("theme-studio");
  await studio.waitFor();
  await studio.getByRole("button", { name: "Start designer", exact: true }).first().click();
  await Promise.race([
    page.waitForURL(/\/workspace\//, { timeout: 60000 }),
    page
      .getByRole("alert")
      .first()
      .waitFor({ timeout: 60000 })
      .then(async () => {
        throw new Error(`Designer launch failed: ${await page.getByRole("alert").first().innerText()}`);
      }),
  ]);
  await page
    .getByPlaceholder("Message the agent, tag @files, or use /commands and /skills")
    .waitFor({ timeout: 60000 });
  const started = await state();
  session = { agentId: started.designerAgentId, workspaceId: started.designerWorkspaceId };
  assert.ok(session.agentId);
  assert.deepEqual(started.active, before.active, "Starting the designer must not activate a pack.");
  const inspection = JSON.parse(
    (await cli("paseo", ["--host", host, "inspect", session.agentId, "--json"], { maxBuffer: 4 * 1024 * 1024 })).stdout,
  );
  await writeFile("output/pack-agent-inspection.json", JSON.stringify(inspection, null, 2));
  assert.match(JSON.stringify(inspection), /gpt-6\.1-sol/);
  assert.match(JSON.stringify(inspection), /high/);
  const composer = page.getByPlaceholder("Message the agent, tag @files, or use /commands and /skills");
  await composer.fill(prompt);
  await composer.press("Enter");
  await page.screenshot({ path: "output/theme-studio-pack-agent-working.png" });
  const deadline = Date.now() + 300000;
  let patched;
  while (Date.now() < deadline) {
    const current = await state();
    if (current.current.ui.radius === 14 && current.current.ui.panel.title === "Agent generated") {
      patched = current;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(patched, "The real model must patch the isolated draft within five minutes.");
  assert.deepEqual(patched.current.ui.panel, panel);
  assert.deepEqual(patched.current.ui, { ...before.current.ui, radius: 14, panel });
  assert.deepEqual(patched.current.colors, before.current.colors);
  assert.deepEqual(patched.active, before.active, "The MCP edit must leave the active pack unchanged.");
  assert.ok(
    patched.history.some(
      entry =>
        entry.source === "agent" && entry.theme.ui.radius === 14 && entry.theme.ui.panel.title === "Agent generated",
    ),
  );
  await cli("paseo", ["--host", host, "wait", session.agentId, "--timeout", "180", "--json"], {
    maxBuffer: 4 * 1024 * 1024,
  });
  await page.waitForTimeout(1000);
  const logs = (
    await cli("paseo", ["--host", host, "logs", session.agentId, "--tail", "100", "--json"], {
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout;
  await writeFile("output/pack-agent-timeline.txt", logs);
  assert.match(logs, /read_theme/);
  assert.match(logs, /patch_theme/);
  await studio.getByRole("button", { name: "Preview", exact: true }).first().click();
  await page
    .getByTestId("paseo-preview")
    .getByRole("tab", { name: /preview/ })
    .filter({ hasText: "Activity" })
    .click()
    .catch(async () => {
      await page
        .getByTestId("paseo-preview")
        .getByRole("tab", { name: "Agent generated preview", exact: true })
        .click();
    });
  await page.getByTestId("paseo-preview").getByText("Prepared by the isolated designer.", { exact: true }).waitFor();
  await page.screenshot({ path: "output/theme-studio-pack-agent-native-chat.png" });
  assert.deepEqual(
    await Promise.all(mainPaths.map(fingerprint)),
    mainBefore,
    "The main user studio and daemon config must remain unchanged.",
  );
  assert.equal(
    await fingerprint(`${qaHome}/config.json`),
    isolatedConfigBefore,
    "The test must not edit daemon config.",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const evidence = {
    checks: [
      "new isolated GPT-6.1 Sol high designer",
      "real native chat prompt",
      "MCP read_theme and patch_theme",
      "radius and all four panel block types edited",
      "draft palette preserved",
      "active pack unchanged",
      "agent-authored history preserved",
      "preview rendered agent panel",
      "main studio and configs unchanged",
    ],
    session,
    beforeRevision: before.revision,
    afterRevision: patched.revision,
    panel,
    errors,
    screenshot: "output/theme-studio-pack-agent-native-chat.png",
  };
  await writeFile("output/pack-agent-qa.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: "output/theme-studio-pack-agent-error.png" });
  console.error(
    JSON.stringify({ session, url: page.url(), errors, alerts: await page.getByRole("alert").allTextContents() }),
  );
  throw error;
} finally {
  await browser.close();
}
