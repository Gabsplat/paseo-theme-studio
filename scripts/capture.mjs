import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PASEO_QA_CHROMIUM || "/home/gabsplat/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto(process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:6767");
  await page.getByText("Theme Studio", { exact: true }).first().click();
  const studioUrl = page.url();
  await page.goto("http://127.0.0.1:6767/settings/appearance");
  await page.getByText("System", { exact: true }).click();
  await page.getByText("Theme Studio · Live", { exact: true }).click();
  await page.goto(studioUrl);
  await page.getByTestId("theme-studio").getByRole("button", { name: "Open designer chat", exact: true }).click();
  await page.waitForURL(/\/workspace\//);
  await page.waitForTimeout(1500);
  const handles = await page.locator("*").evaluateAll(nodes =>
    nodes
      .filter(n => ["col-resize", "ew-resize"].includes(getComputedStyle(n).cursor))
      .map(n => {
        const r = n.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
      })
      .filter(r => r.height > 200),
  );
  if (handles.length) {
    const h = handles.at(-1);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(1020, h.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "output/theme-studio-end-to-end.png" });
  console.log(
    JSON.stringify({ checks: ["native chat and live preview screenshot"], url: page.url(), errors }, null, 2),
  );
  assert.equal(errors.length, 0);
} catch (error) {
  await page.screenshot({ path: "output/theme-studio-agent-error.png" });
  throw error;
} finally {
  await browser.close();
}
