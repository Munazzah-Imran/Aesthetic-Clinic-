/** Removed permission options + Delete Staff dialog UI checks. Run: node .tmp-wizard-delete-ui-test.mjs */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = Date.now();
const email = `uidel-${stamp}@example.com`;
const staffName = `UI Delete Target ${stamp}`;
const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
const body = (page) => page.evaluate(() => document.body.textContent ?? "");
const clickButton = (page, text) =>
  page.evaluate((t) => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(t))?.click();
  }, text);

const REMOVED = [
  "Uploaded Reports / Images",
  "Virtual Consultation",
  "Emergency Alerts",
  "Staff Inbox",
  "Human Handover",
  "Staff",
  "Audit Logs",
  "System Health",
];
const EXPECTED = [
  "Overview / Dashboard",
  "Appointments",
  "Calendar",
  "Patients",
  "Doctor Profile",
  "Clinics",
  "Weekly Schedule",
  "Off-Days",
  "Special Schedules",
  "Blocked Slots",
  "Services / Treatments",
  "Reminders",
  "Settings",
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 950 });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });

  // ---------- Add wizard: Step 2 option set ----------
  await clickButton(page, "Add Staff");
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  await page.type("#staff-full-name", staffName);
  await page.type("#staff-email", email);
  await page.evaluate(() => document.querySelectorAll('button[aria-haspopup="listbox"]')[0]?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.trim().startsWith("Nurse"))?.click();
  });
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label")).map((l) => l.textContent?.trim() ?? "")
  );
  check("wizard shows exactly the 13 assignable options", labels.length === 13 && EXPECTED.every((e) => labels.includes(e)), JSON.stringify(labels));
  const leaked = REMOVED.filter((r) => labels.includes(r));
  check("none of the 8 removed options appear", leaked.length === 0, JSON.stringify(leaked));
  check("Reminders remains selectable", labels.includes("Reminders"));
  check("count reads 0 of 13", (await body(page)).includes("0 of 13 pages selected"));

  // Select All / Clear All operate on the 13
  await clickButton(page, "Select All");
  await new Promise((r) => setTimeout(r, 300));
  check("Select All -> 13 of 13", (await body(page)).includes("13 of 13 pages selected"));
  await clickButton(page, "Clear All");
  await new Promise((r) => setTimeout(r, 300));

  // Pick Reminders + Appointments and create
  await page.evaluate(() => {
    const wanted = ["Reminders", "Appointments"];
    Array.from(document.querySelectorAll("label")).forEach((l) => {
      if (wanted.includes(l.textContent?.trim())) l.querySelector("input[type=checkbox]")?.click();
    });
  });
  await new Promise((r) => setTimeout(r, 300));
  await clickButton(page, "Create Staff Account");
  const created = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff account created."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("member created from wizard", created);
  await new Promise((r) => setTimeout(r, 1200));

  // ---------- Edit wizard: Step 2 also has only the 13, shows current grants ----------
  await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    row?.querySelector('button[aria-label^="Edit "]')?.click();
  }, email);
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  await clickButton(page, "Next");
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  const editLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label")).map((l) => l.textContent?.trim() ?? "")
  );
  check("edit wizard shows the same 13 options", editLabels.length === 13 && EXPECTED.every((e) => editLabels.includes(e)), JSON.stringify(editLabels));
  check("edit wizard shows current grants (2 of 13)", (await body(page)).includes("2 of 13 pages selected"));
  check("edit wizard has no removed options", REMOVED.every((r) => !editLabels.includes(r)));
  await clickButton(page, "Back");
  await new Promise((r) => setTimeout(r, 300));
  await clickButton(page, "Cancel"); // no changes -> closes silently
  await new Promise((r) => setTimeout(r, 500));

  // ---------- Delete confirmation dialog ----------
  const rowsBefore = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    row?.querySelector('button[aria-label^="Delete "]')?.click();
  }, email);
  await new Promise((r) => setTimeout(r, 500));
  const dialogText = await page.evaluate(() => document.querySelector(".fixed.inset-0.z-50")?.textContent ?? "NO-DIALOG");
  check("dialog title exact", dialogText.includes("Delete Staff Member?"), dialogText.slice(0, 120));
  check(
    "dialog message exact",
    dialogText.includes(
      "Are you sure you want to delete this staff member? Their access to the dashboard will be revoked. This action cannot be undone."
    )
  );
  const btnTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).map((b) => b.textContent?.trim())
  );
  check("dialog buttons Cancel + Delete Staff", btnTexts.includes("Cancel") && btnTexts.includes("Delete Staff"), JSON.stringify(btnTexts));
  await page.screenshot({ path: ".tmp-delete-dialog.png" });

  // Cancel -> nothing deleted
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).find((b) => b.textContent?.trim() === "Cancel")?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const rowsAfterCancel = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("Cancel keeps the member", rowsAfterCancel === rowsBefore && (await body(page)).includes(staffName), `rows ${rowsBefore} -> ${rowsAfterCancel}`);

  // Confirm -> deleted, toast, list refreshed
  await page.evaluate((em) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(em));
    row?.querySelector('button[aria-label^="Delete "]')?.click();
  }, email);
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).find((b) => b.textContent?.trim() === "Delete Staff")?.click();
  });
  const deleted = await page
    .waitForFunction(() => (document.body.textContent ?? "").includes("Staff member deleted."), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("delete confirms with success toast", deleted);
  await new Promise((r) => setTimeout(r, 1200));
  const stillListed = (await body(page)).includes(staffName);
  const rowsAfterDelete = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("list refreshed without the member", !stillListed && rowsAfterDelete === rowsBefore - 1, `rows ${rowsBefore} -> ${rowsAfterDelete}`);
  await page.screenshot({ path: ".tmp-delete-after.png" });
} catch (err) {
  results.push(`ERROR ${err?.message ?? err}`);
} finally {
  console.log(results.join("\n"));
  await browser.close();
  const failed = results.some((line) => line.startsWith("FAIL") || line.startsWith("ERROR"));
  process.exit(failed ? 1 : 0);
}
