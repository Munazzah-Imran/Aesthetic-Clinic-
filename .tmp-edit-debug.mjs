/** Debug: open Edit modal after create, dump modal state. */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1400, height: 950 });
  page.on("console", (m) => console.log("[console]", m.type(), m.text()));
  page.on("response", (r) => {
    if (r.url().includes("/api/staff/")) console.log("[response]", r.status(), r.url());
  });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });

  const clicked = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes("Two Step Staff"));
    const btn = row?.querySelector('button[aria-label^="Edit "]');
    btn?.click();
    return Boolean(btn);
  });
  console.log("edit button found+clicked:", clicked);
  await new Promise((r) => setTimeout(r, 4000));
  const stateInfo = await page.evaluate(() => ({
    hasInput: Boolean(document.querySelector("#staff-full-name")),
    modalText: (document.querySelector(".fixed.inset-0.z-50")?.textContent ?? "NO-MODAL").slice(0, 600),
  }));
  console.log(JSON.stringify(stateInfo, null, 2));
  await page.screenshot({ path: ".tmp-edit-debug.png" });
} finally {
  await browser.close();
}
