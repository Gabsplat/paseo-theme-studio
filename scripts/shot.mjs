// Screenshot a Theme Studio view in the isolated QA daemon.
// Usage: node scripts/shot.mjs <output.png> [width] [height] [path] [dark|light]
import { chromium } from "playwright";

const [output = "output/shot.png", width = "1600", height = "1000", path = "", scheme = "dark"] = process.argv.slice(2);
const origin = process.env.PASEO_QA_ORIGIN || "http://127.0.0.1:7789";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PASEO_QA_CHROMIUM || "/home/gabsplat/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  colorScheme: scheme === "light" ? "light" : "dark",
});
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => message.type() === "error" && errors.push(message.text()));
await page.goto(origin + path);
await page.waitForTimeout(2500);
if (!path) {
  await page.getByText("Theme Studio", { exact: true }).first().click();
  await page.waitForTimeout(2500);
}
for (const step of (process.env.SHOT_CLICKS || "").split("|").filter(Boolean)) {
  await page.getByText(step, { exact: true }).first().click();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: output });
console.log(JSON.stringify({ url: page.url(), errors: errors.slice(0, 5) }));
await browser.close();
