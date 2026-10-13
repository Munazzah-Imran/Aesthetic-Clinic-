/** Final smoke: staff page loads, Edit/Permissions modals render real fields. */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

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
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });
  const rows = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("staff list loads with rows", rows > 0, `rows=${rows}`);

  await page.evaluate(() => document.querySelector('button[aria-label^="Edit "]')?.click());
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  const nameVal = await page.$eval("#staff-full-name", (el) => el.value);
  check("Edit modal shows prefilled Full Name field", nameVal.length > 0, `value=${nameVal}`);
  const hasPwdField = await page.evaluate(() => !!document.querySelector("#staff-password"));
  check("Edit modal has no password field (correct for edit)", !hasPwdField);
  await page.screenshot({ path: ".tmp-final-edit-modal.png" });
  await page.evaluate(() => document.querySelector('button[aria-label="Close"]')?.click());
  await new Promise((r) => setTimeout(r, 500));

  await page.evaluate(() => document.querySelector('button[aria-label^="Manage permissions"]')?.click());
  await page.waitForFunction(
    () => document.body.textContent?.includes("pages selected") === true,
    { timeout: 30000 }
  );
  const checked = await page.evaluate(() => document.querySelectorAll('.fixed input[type="checkbox"]').length);
  check("Permissions modal renders page checkboxes", checked > 0, `checkboxes=${checked}`);
  await page.screenshot({ path: ".tmp-final-perm-modal.png" });

  check("no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" || "));
  console.log(results.join("\n"));
} finally {
  await browser.close();
}
