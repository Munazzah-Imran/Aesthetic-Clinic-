/** Two-step Add/Edit Staff form check. Run: node .tmp-two-step-test.mjs */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = Date.now();
const email = `twostep-${stamp}@example.com`;
const staffName = `Two Step Staff ${stamp}`;
const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
const body = (page) => page.evaluate(() => document.body.textContent ?? "");
const clickButton = (page, text) =>
  page.evaluate((t) => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(t))?.click();
  }, text);
const modalOpen = (page) =>
  page.evaluate(() => Boolean(document.querySelector("#staff-full-name")));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 950 });
  const dialogs = [];
  let dialogAction = "accept";
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    if (dialogAction === "cancel") await d.dismiss();
    else await d.accept();
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });
  const rowsBefore = await page.evaluate(() => document.querySelectorAll("tbody tr").length);

  // --- Open Add Staff -> must land on Step 1 ---
  await clickButton(page, "Add Staff");
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  let txt = await body(page);
  check("opens on Step 1 header", txt.includes("Step 1 of 2 — Staff Account Setup"));
  check("stepper shows 1. Account Setup / 2. Permissions", txt.includes("1. Account Setup") && txt.includes("2. Permissions"));
  check("step 1 description", txt.includes("Enter the staff member's details and set up their account."));
  check("step 1 has Cancel + Next", txt.includes("Cancel") && txt.includes("Next"));
  check("no permission checklist yet on step 1", !txt.includes("Select All"));
  await page.screenshot({ path: ".tmp-two-step-step1.png" });

  // --- Next with empty required fields -> inline errors, stays on Step 1, no account created ---
  await clickButton(page, "Next");
  await new Promise((r) => setTimeout(r, 500));
  txt = await body(page);
  check("Next blocks on missing fields", txt.includes("Full name is required") && txt.includes("Email address is required"));
  check("stays on Step 1 after failed Next", txt.includes("Step 1 of 2"));
  check("no account created by Next clicks", (await page.evaluate(() => document.querySelectorAll("tbody tr").length)) === rowsBefore);
  await clickButton(page, "Next");
  await clickButton(page, "Next");
  await new Promise((r) => setTimeout(r, 300));
  check("repeated Next never creates rows", (await page.evaluate(() => document.querySelectorAll("tbody tr").length)) === rowsBefore);

  // --- Fill Step 1, pick designation + password, Next -> Step 2 ---
  await page.type("#staff-full-name", staffName);
  await page.type("#staff-email", email);
  await page.type("#staff-phone", "0300-1112223");
  await page.evaluate(() => document.querySelectorAll('button[aria-haspopup="listbox"]')[0]?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.trim().startsWith("Nurse"))?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  txt = await body(page);
  check("Next advances to Step 2 header", txt.includes("Step 2 of 2 — Assign Permissions"));
  check("step 2 description", txt.includes("Choose which dashboard sections this staff member can access."));
  check("step 2 shows permission checklist", txt.includes("Select All") && txt.includes("Clear All"));
  check("nothing granted by default", txt.includes("0 of 13 pages selected"));
  check("step 2 buttons Back/Cancel/Create", txt.includes("Back") && txt.includes("Cancel") && txt.includes("Create Staff Account"));
  await page.screenshot({ path: ".tmp-two-step-step2.png" });

  // --- Select All / Clear All only touch this form ---
  await clickButton(page, "Select All");
  await new Promise((r) => setTimeout(r, 300));
  check("Select All selects every module", (await body(page)).includes("13 of 13 pages selected"));
  await clickButton(page, "Clear All");
  await new Promise((r) => setTimeout(r, 300));
  check("Clear All empties selection", (await body(page)).includes("0 of 13 pages selected"));

  // Pick exactly two modules
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label"));
    ["Appointments", "Patients"].forEach((name) => {
      const lab = labels.find((l) => l.textContent?.trim() === name);
      lab?.querySelector("input[type=checkbox]")?.click();
    });
  });
  await new Promise((r) => setTimeout(r, 300));
  check("two modules selected", (await body(page)).includes("2 of 13 pages selected"));

  // --- Back preserves entered values ---
  await clickButton(page, "Back");
  await new Promise((r) => setTimeout(r, 300));
  check("Back returns to Step 1", (await body(page)).includes("Step 1 of 2"));
  const preserved = await page.evaluate(() => ({
    name: document.querySelector("#staff-full-name")?.value,
    email: document.querySelector("#staff-email")?.value,
    phone: document.querySelector("#staff-phone")?.value,
    pwd: document.querySelector("#staff-password")?.value,
  }));
  check(
    "Back preserves all Step 1 values",
    preserved.name === staffName && preserved.email === email && preserved.phone === "0300-1112223" && preserved.pwd === state.staffPassword,
    JSON.stringify(preserved)
  );

  // --- Next again -> Create Staff Account ---
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  check("permission selection preserved across Back/Next", (await body(page)).includes("2 of 13 pages selected"));
  await clickButton(page, "Create Staff Account");
  const created = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff account created."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("create succeeds with success toast", created);
  await new Promise((r) => setTimeout(r, 1200));
  const assigned = await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    return row?.children[6]?.textContent ?? "";
  }, email);
  check("new staff listed with assigned pages", assigned.includes("Appointments") && assigned.includes("Patients"), assigned);

  // --- Edit: Step 1 prefilled, Step 2 shows current permissions ---
  await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    row?.querySelector('button[aria-label^="Edit "]')?.click();
  }, email);
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  const prefill = await page.evaluate(() => document.querySelector("#staff-full-name")?.value);
  check("edit Step 1 loaded existing details", prefill === staffName, `value=${prefill}`);
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  const checked = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("label").forEach((l) => {
      const cb = l.querySelector("input[type=checkbox]");
      if (cb?.checked) out.push(l.textContent?.trim());
    });
    return out;
  });
  check("edit Step 2 shows currently assigned permissions", checked.includes("Appointments") && checked.includes("Patients"), JSON.stringify(checked));
  await page.screenshot({ path: ".tmp-two-step-edit-step2.png" });

  // --- Unsaved-change confirmation on Cancel (dismiss keeps form open) ---
  await clickButton(page, "Back");
  await new Promise((r) => setTimeout(r, 300));
  await page.type("#staff-phone", "9");
  dialogAction = "cancel";
  await clickButton(page, "Cancel");
  await new Promise((r) => setTimeout(r, 500));
  check("Cancel with unsaved changes asks for confirmation", dialogs.length === 1, JSON.stringify(dialogs));
  check("dismissing the confirmation keeps the form open", await modalOpen(page));
  dialogAction = "accept";

  // Restore the phone, go to Step 2 and Save Changes (update, never duplicate)
  await page.evaluate(() => {
    const el = document.querySelector("#staff-phone");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (el && setter) {
      setter.call(el, "0300-1112223");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  await clickButton(page, "Save Changes");
  const updated = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff member updated."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("Save Changes updates without duplicating", updated);
  await new Promise((r) => setTimeout(r, 1000));
  const rowsAfter = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("row count unchanged after edit", rowsAfter === rowsBefore + 1, `before=${rowsBefore} after=${rowsAfter}`);

  // --- Cancel without changes closes with NO confirmation ---
  await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    row?.querySelector('button[aria-label^="Edit "]')?.click();
  }, email);
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  const dialogsBefore = dialogs.length;
  await clickButton(page, "Cancel");
  await new Promise((r) => setTimeout(r, 500));
  check(
    "Cancel without unsaved changes closes silently",
    dialogs.length === dialogsBefore && !(await modalOpen(page)),
    `dialogs=${dialogs.length}`
  );
} catch (err) {
  results.push(`ERROR ${err?.message ?? err}`);
} finally {
  console.log(results.join("\n"));
  await browser.close();
}
