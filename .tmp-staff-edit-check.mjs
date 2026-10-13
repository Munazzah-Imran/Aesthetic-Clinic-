/** Edit / Permissions / View modal check on /dashboard/staff. Run: node .tmp-staff-edit-check.mjs */
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

async function login(page, token) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 950 });
  const netErrors = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) netErrors.push(`${r.status()} ${r.url()}`);
  });

  await login(page, state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").includes("Staff"), { timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));

  const rows = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("list rows", rows > 0, `rows=${rows}`);

  // ---- EDIT modal ----
  netErrors.length = 0;
  await page.evaluate(() => {
    document.querySelector('button[aria-label^="Edit "]')?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: ".tmp-check-edit-modal.png" });
  const edit = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0 .max-w-3xl");
    return {
      modalText: (modal?.textContent ?? "").slice(0, 500),
      hasName: !!document.querySelector("#staff-full-name"),
      nameValue: (document.querySelector("#staff-full-name") ?? {}).value ?? null,
      hasEmail: !!document.querySelector("#staff-email"),
      spinner: !!document.querySelector(".animate-spin"),
    };
  });
  check("Edit modal opens", !!edit.modalText, "");
  check("Edit modal has Full Name field", edit.hasName, `value=${edit.nameValue}`);
  check("Edit modal has no load error", !edit.modalText.includes("Unable to load"), edit.modalText.slice(0, 120));
  check("Edit modal no 4xx API", netErrors.length === 0, netErrors.join(" ; "));

  if (edit.hasName) {
    // change phone and save
    await page.evaluate(() => {
      const el = document.querySelector("#staff-phone");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "0300-1112233");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => {
      Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Save Changes"))?.click();
    });
    await new Promise((r) => setTimeout(r, 3500));
    const after = await page.evaluate(() => document.body.textContent ?? "");
    check("Edit save succeeds", after.includes("Staff member updated."), after.slice(0, 0));
    await page.screenshot({ path: ".tmp-check-edit-saved.png" });
  }

  // ---- PERMISSIONS modal ----
  netErrors.length = 0;
  await page.evaluate(() => {
    document.querySelector('button[aria-label^="Manage permissions"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const perm = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0 .max-w-3xl");
    return { text: (modal?.textContent ?? "").slice(0, 300), checkboxes: document.querySelectorAll('.fixed input[type="checkbox"]').length };
  });
  check("Permissions modal loads", perm.checkboxes > 0 || perm.text.includes("not"), JSON.stringify(perm).slice(0, 200));
  await page.screenshot({ path: ".tmp-check-perm-modal.png" });
  // close if open
  await page.evaluate(() => document.querySelector('button[aria-label="Close"]')?.click());
  await new Promise((r) => setTimeout(r, 500));

  // ---- VIEW modal ----
  await page.evaluate(() => {
    document.querySelector('button[aria-label^="View "]')?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const view = await page.evaluate(() => (document.querySelector(".fixed.inset-0")?.textContent ?? "").slice(0, 300));
  check("View modal shows name", /Staff Member/.test(view) && !view.includes("not found"), view.slice(0, 100));
  await page.screenshot({ path: ".tmp-check-view-modal.png" });

  // ---- VIEWER account (non-admin with staff permission) ----
  await login(page, state.viewerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").includes("Staff"), { timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  const viewer = await page.evaluate(() => ({
    addBtn: Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Add Staff")),
    rows: document.querySelectorAll("tbody tr").length,
    empty: (document.body.textContent ?? "").includes("No staff members yet"),
    failed: (document.body.textContent ?? "").includes("Unable to load staff"),
  }));
  check("viewer sees rows or honest empty state", viewer.rows > 0 || viewer.empty, JSON.stringify(viewer));
  await page.screenshot({ path: ".tmp-check-viewer-staff.png" });

  console.log(results.join("\n"));
  console.log("netErrors(last):", netErrors.join(" ; "));
} finally {
  await browser.close();
}
