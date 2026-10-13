/**
 * FOCUSED UI TEST — the three interactions that were only code-reviewed in the
 * previous run: status filter, upload-date filter, phone & token search.
 * Requires: dev server on :3000 + .tmp-reports-seed.mjs output (3 reports of
 * mixed statuses: uploaded / reviewed / archived, one patient, one appointment).
 * Run: TEST_PORT=3000 node .tmp-reports-filters-test.mjs
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const state = JSON.parse(fs.readFileSync(".tmp-reports-ui.json", "utf8"));

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const consoleErrors = [];
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("tbody tr").length);
const statusCells = (page) =>
  page.$$eval("tbody tr", (rows) =>
    rows.map((r) => (r.querySelectorAll("td")[7]?.textContent ?? "").trim())
  );
const rowText = (page) =>
  page.$$eval("tbody tr", (rows) =>
    rows.map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent.trim()).join(" | "))
  );
const clearFilters = async (page) => {
  await page.$$eval("button", (btns) => {
    const c = btns.find((x) => x.textContent.trim() === "Clear");
    if (c) c.click();
  });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, {
    timeout: 10000,
  });
};
const typeSearch = async (page, text) => {
  const input = await page.$('input[aria-label="Search reports"]');
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (text) await input.type(text);
};
const searchMatches = async (page, text, expectedCount) => {
  await typeSearch(page, text);
  await page.waitForFunction(
    (n) => {
      const rows = document.querySelectorAll("tbody tr").length;
      const empty = document.body.textContent.includes("No reports match your search.");
      return rows === n || (n === 0 && empty);
    },
    { timeout: 8000 },
    expectedCount
  );
  return rowCount(page);
};
const pickStatus = async (page, label) => {
  const opened = await page.$$eval('button[aria-haspopup="listbox"]', (btns) => {
    const b = btns.find((x) => x.textContent.includes("Status:"));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) return false;
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  const picked = await page.$$eval(
    '[role="listbox"] button',
    (opts, target) => {
      const o = opts.find((x) => x.textContent.trim() === target);
      if (o) o.click();
      return !!o;
    },
    `Status: ${label}`
  );
  await page.waitForFunction((t) => {
    const b = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).find((x) =>
      x.textContent.includes("Status:")
    );
    return b && b.textContent.includes(t);
  }, { timeout: 5000 }, label);
  return picked;
};
const setDateString = async (page, value) => {
  await page.$eval(
    'input[aria-label="Filter by upload date"]',
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e}`));
  page.on("console", (m) => {
    const url = m.location()?.url ?? "";
    if (m.type() === "error" && !url.includes("favicon")) {
      consoleErrors.push(`console: ${m.text()} @ ${url}`);
    }
  });

  // Auth the way the app does, then open the directory.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.token);
  await page.goto(`${BASE}/dashboard/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, {
    timeout: 60000,
  });

  const initial = await statusCells(page);
  check(
    "F1  seed has mixed statuses (uploaded/reviewed/archived)",
    ["Uploaded", "Reviewed", "Archived"].every((s) => initial.some((x) => x.includes(s))),
    initial.join(", ")
  );

  // ---- status filter ----
  const gotReviewed = await pickStatus(page, "Reviewed");
  if (gotReviewed) {
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, {
      timeout: 8000,
    });
    const cells = await statusCells(page);
    check(
      "F2  status filter = Reviewed shows only the reviewed row",
      cells.length === 1 && cells[0].includes("Reviewed"),
      cells.join(", ")
    );
    await pickStatus(page, "Archived");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, {
      timeout: 8000,
    });
    const arch = await statusCells(page);
    check(
      "F3  status filter = Archived shows only the archived row",
      arch.length === 1 && arch[0].includes("Archived"),
      arch.join(", ")
    );
    await pickStatus(page, "Uploaded");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, {
      timeout: 8000,
    });
    const up = await statusCells(page);
    check(
      "F4  status filter = Uploaded shows only the uploaded row",
      up.length === 1 && up[0].includes("Uploaded"),
      up.join(", ")
    );
    await pickStatus(page, "All");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, {
      timeout: 8000,
    });
    check("F5  status filter back to All restores 3 rows", (await rowCount(page)) === 3);
  } else {
    check("F2/F3/F4/F5 status filter FormSelect not found", false);
  }

  // ---- date filter ----
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  await setDateString(page, today);
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, {
    timeout: 8000,
  });
  check("F6  date filter = today keeps all 3 rows (seeded today)", (await rowCount(page)) === 3);

  await setDateString(page, "2020-01-01");
  await page.waitForFunction(
    () => document.body.textContent.includes("No reports match your search."),
    { timeout: 8000 }
  );
  const emptyShown = await page.evaluate(() =>
    document.body.textContent.includes("No reports match your search.")
  );
  check("F7  date filter = an empty day shows the no-match empty state", emptyShown);
  const dateRows = await rowCount(page);
  check("F8  unmatched date shows 0 table rows", dateRows === 0, `rows=${dateRows}`);

  await clearFilters(page);
  check("F9  Clear restores all 3 rows", (await rowCount(page)) === 3);

  // ---- phone search (positive + negative) ----
  const phoneN = await searchMatches(page, "4455667", 3);
  check(
    "F10 phone search matches the patient's 3 rows",
    phoneN === 3,
    `rows=${phoneN}`
  );
  const phoneRows = await rowText(page);
  check(
    "F11 phone search rows actually show that phone",
    phoneRows.every((t) => t.includes("4455667")),
    phoneRows[0]?.slice(0, 60)
  );
  const phoneMiss = await searchMatches(page, "000 000 000", 0);
  check("F12 phone search with unknown number -> 0 rows", phoneMiss === 0);

  await clearFilters(page);

  // ---- token search (the Appointment / Token column = APT code; the lab
  // report was seeded WITHOUT an appointment, so it must NOT match) ----
  const tokenN = await searchMatches(page, "APT-", 2);
  check(
    "F13 token search by appointment code matches only rows that have one",
    tokenN === 2,
    `rows=${tokenN}`
  );
  const tokenRows = await rowText(page);
  check(
    "F14 token search rows actually show that token",
    tokenRows.length === 2 && tokenRows.every((t) => t.includes("APT-")),
    tokenRows[0]?.slice(0, 60)
  );
  const tokenMiss = await searchMatches(page, "ZZZZZZ", 0);
  check("F15 token search with unknown token -> 0 rows", tokenMiss === 0);

  await clearFilters(page);
  check(
    "F16 final state = 3 rows, no filters active",
    (await rowCount(page)) === 3
  );
  check("F17 zero console/page errors during the run", consoleErrors.length === 0, consoleErrors.join(" ;; ").slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
