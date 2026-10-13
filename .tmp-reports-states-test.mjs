/**
 * State tests for the Uploaded Reports page (spec items 16–18):
 *   - EMPTY state   → "No medical documents or skin photographs uploaded yet."
 *   - LOADING state → skeleton rows (no fake data) while GET /api/reports is slow
 *   - ERROR state   → "Unable to load uploaded reports." + working Retry
 *
 * Uses a throwaway business with NO reports + request interception.
 * Run: node .tmp-reports-states-test.mjs
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

// throwaway business with NO uploads
const email = `reports-states-${Date.now()}@example.com`;
const signup = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    businessName: "States Test Clinic",
    name: "States Test",
    email,
    password: "secret123",
  }),
});
const signupJson = await signup.json();
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "secret123" }),
});
const token = (await login.json()).data.token;
const businessId = signupJson.data.business.id;

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
let delayReports = false;
let failReports = false;
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/reports") && req.method() === "GET" && !url.includes("/file")) {
      if (failReports) {
        return req.respond({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            data: null,
            error: "boom",
            success: false,
            message: "Unable to load uploaded reports",
          }),
        });
      }
      if (delayReports) {
        return setTimeout(() => req.continue().catch(() => {}), 2500);
      }
    }
    req.continue().catch(() => {});
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);

  // ---- LOADING skeleton (delayed response, no fake rows) ----
  delayReports = true;
  await page.goto(`${BASE}/dashboard/reports`, { waitUntil: "domcontentloaded" });
  const sawSkeleton = await page
    .waitForFunction(
      () =>
        document.querySelectorAll(".animate-pulse").length >= 4 &&
        document.querySelectorAll("tbody tr").length === 0,
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check(
    "T1  loading: skeleton rows shown, zero fake data rows",
    sawSkeleton
  );
  await page.screenshot({ path: ".tmp-reports-loading.png" });
  delayReports = false;

  // ---- EMPTY state ----
  const emptyOk = await page
    .waitForFunction(
      () =>
        document.body.textContent.includes(
          "No medical documents or skin photographs uploaded yet."
        ) && document.querySelectorAll("tbody tr").length === 0,
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check(
    "T2  empty state message inside the table area",
    emptyOk
  );
  await page.screenshot({ path: ".tmp-reports-empty.png", fullPage: true });

  // ---- ERROR state + Retry ----
  failReports = true;
  await page.$$eval("button", (btns) => {
    const b = btns.find((x) => x.textContent.includes("Refresh Reports"));
    if (b) b.click();
  });
  const errOk = await page
    .waitForFunction(
      () =>
        document.body.textContent.includes("Unable to load uploaded reports") &&
        Array.from(document.querySelectorAll("button")).some((b) =>
          b.textContent.includes("Retry")
        ),
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("T3  error message + Retry shown when loading fails", errOk);
  await page.screenshot({ path: ".tmp-reports-error.png", fullPage: true });

  // Retry with a healthy backend must recover WITHOUT a browser reload.
  failReports = false;
  await page.$$eval("button", (btns) => {
    const b = btns.find((x) => x.textContent.trim() === "Retry");
    if (b) b.click();
  });
  const recovered = await page
    .waitForFunction(
      () =>
        document.body.textContent.includes(
          "No medical documents or skin photographs uploaded yet."
        ),
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("T4  Retry recovers to the empty state (no full reload)", recovered);
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  await browser.close();
  // cleanup throwaway business
  const pg = (await import("pg")).default;
  const env = fs.readFileSync(".env", "utf8");
  const pool = new pg.Pool({
    connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
    ssl: { rejectUnauthorized: false },
  });
  await pool.query("DELETE FROM business WHERE id = $1", [businessId]);
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((l) => l.startsWith("FAIL"))) process.exit(1);
console.log("\nSTATE TESTS PASSED");
