import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/gabsplat/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", e => console.log("PAGE ERROR", e.message));
await page.goto("http://127.0.0.1:6767");
await page.getByText("Theme Studio", { exact: true }).first().click();
const studio = page.getByTestId("theme-studio");
await studio.getByRole("button", { name: "Open designer chat", exact: true }).click();
await page.waitForTimeout(5000);
await page.screenshot({ path: "output/theme-studio-native-chat.png" });
console.log(
  JSON.stringify(
    { url: page.url(), panel: await studio.count(), alerts: await page.getByRole("alert").allTextContents() },
    null,
    2,
  ),
);
await browser.close();
