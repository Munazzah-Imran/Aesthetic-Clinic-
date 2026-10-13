/** Add Staff flow on final code. Run: node .tmp-add-flow-check.mjs */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = Date.now();
const email = `check-add-${stamp}@example.com`;
const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 950 });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });

  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Add Staff"))?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  await page.type("#staff-full-name", "Temp Add Flow");
  await page.type("#staff-email", email);
  await page.type("#staff-phone", "0300-0000000");
  await page.evaluate(() => document.querySelector('button[aria-haspopup="listbox"]')?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.trim().startsWith("Nurse"))?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Create Staff"))?.click();
  });
  const ok = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff account created."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("create succeeds (success toast)", ok);
  await new Promise((r) => setTimeout(r, 1000));
  check("new row listed", (await page.evaluate(() => document.body.textContent ?? "")).includes("Temp Add Flow"));
  await page.screenshot({ path: ".tmp-add-flow.png" });

  // Edit the row we just created (name field prefilled + save)
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes("Temp Add Flow"));
    row?.querySelector('button[aria-label^="Edit "]')?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  const val = await page.$eval("#staff-full-name", (el) => el.value);
  check("edit modal prefilled with that member", val === "Temp Add Flow", `value=${val}`);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Save Changes"))?.click();
  });
  const saved = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff member updated."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("edit save succeeds", saved);

  console.log(results.join("\n"));
  console.log("TEST_EMAIL=" + email);
} finally {
  await browser.close();
}
