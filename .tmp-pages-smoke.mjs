/**
 * Smoke test: existing dashboard pages must still render after the
 * Uploaded Reports module was added (spec item 30 — do not break features).
 * Run: node .tmp-pages-smoke.mjs
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-reports-ui.json", "utf8"));
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;

const PAGES = [
  ["/dashboard", "Dashboard"],
  ["/dashboard/appointments", "Appointments"],
  ["/dashboard/patients", "Patients"],
  ["/dashboard/services", "Services"],
  ["/dashboard/reports", "Uploaded Skin Photos"],
];

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    const url = m.location()?.url ?? "";
    if (m.type() === "error" && !url.includes("favicon")) {
      errors.push(`${m.text()} @ ${url}`);
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.token);

  for (const [path, expect] of PAGES) {
    errors.length = 0;
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (needle) => (document.querySelector("h1")?.textContent ?? "").includes(needle),
      { timeout: 60000 },
      expect
    ).catch(() => {});
    const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent ?? "NONE");
    const sidebar = await page.evaluate(() =>
      document.body.textContent.includes("Uploaded Reports / Images")
    );
    check(
      `page ${path} renders`,
      h1.includes(expect) && sidebar && errors.length === 0,
      `h1="${h1}" errors=${errors.slice(0, 2).join(" || ")}`
    );
  }
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  await browser.close();
}

console.log("\n" + results.join("\n"));
if (results.some((l) => l.startsWith("FAIL"))) process.exit(1);
console.log("\nSMOKE TEST PASSED");
