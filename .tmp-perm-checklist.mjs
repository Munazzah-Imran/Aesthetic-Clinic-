/**
 * Verify the staff permission checklist renders exactly 12 options (Reminders removed).
 * Run: node .tmp-perm-checklist.mjs   (needs dev server on :3000)
 *
 * Creates a throwaway owner account, then drives headless Chrome through:
 *   - sidebar / navbar (no Reminders entry, no bell link)
 *   - Add Staff wizard Step 2 checklist
 *   - Manage Permissions modal checklist
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.TEST_PORT ? `http://localhost:${process.env.TEST_PORT}` : "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = Date.now();
const EMAIL = `perm-check-${stamp}@example.com`;
const PASSWORD = `PermCheck-${stamp}-Pass`;

const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- auth: sign up a throwaway owner (falls back to login if it exists) ----
async function getToken() {
  const body = JSON.stringify({ businessName: `Perm Check Clinic ${stamp}`, name: "Perm Checker", email: EMAIL, password: PASSWORD });
  const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const signup = await res.json();
  // signup creates the owner; it does not return a token — log in for one.
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const login = await loginRes.json();
  if (!login.success || !login.data?.token) {
    throw new Error(`auth failed: signup=${JSON.stringify(signup)} login=${JSON.stringify(login)}`);
  }
  // Fresh owners are flagged "must change password" and every API 403s until
  // they do — clear it once so the rest of the app is reachable.
  const nextPassword = `${PASSWORD}-X9`;
  const patch = await fetch(`${BASE}/api/password`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${login.data.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: nextPassword, confirmPassword: nextPassword }),
  });
  const patchJson = await patch.json();
  if (!patchJson.success) throw new Error(`password change failed: ${JSON.stringify(patchJson)}`);
  return login.data.token;
}

const token = await getToken();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });

/** Read every rendered permission option (label wrapping a checkbox). */
const readOptions = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("label"))
      .filter((l) => l.querySelector('input[type="checkbox"]'))
      .map((l) => l.textContent.trim())
  );

const countChecked = (page) => page.evaluate(() => document.querySelectorAll('input[type="checkbox"]:checked').length);

const counterText = (page) =>
  page.evaluate(() => (document.body.textContent.match(/\d+ of \d+ pages selected/) ?? ["NONE"])[0]);

const sidebarLabels = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('nav[aria-label="Dashboard navigation"] a')).map((a) => a.textContent.trim())
  );

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 950 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").includes("Staff"), { timeout: 60000 });

  /* ---------------- sidebar + navbar ---------------- */
  const sidebar = await sidebarLabels(page);
  check("sidebar has no Reminders entry", !sidebar.includes("Reminders"), JSON.stringify(sidebar));
  check("sidebar lists the remaining 12 modules", sidebar.length === 12, `count=${sidebar.length}`);
  const bellLinks = await page.evaluate(() => document.querySelectorAll('a[aria-label="Notifications"], a[href="/dashboard/reminders"]').length);
  check("navbar bell / Reminders link removed", bellLinks === 0, `links=${bellLinks}`);

  /* ---------------- Add Staff wizard: Step 2 checklist ---------------- */
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Add Staff"))?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });

  await page.type("#staff-full-name", "Checklist Probe");
  await page.type("#staff-email", `probe-${stamp}@example.com`);
  await page.type("#staff-password", PASSWORD);
  await page.type("#staff-confirm-password", PASSWORD);

  // Designation (custom listbox)
  await page.evaluate(() => document.querySelectorAll('button[aria-haspopup="listbox"]')[0]?.click());
  await sleep(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.trim().startsWith("Nurse"))?.click();
  });
  await sleep(300);

  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Next"))?.click();
  });
  await page.waitForFunction(() => document.body.textContent.includes("Dashboard Page Permissions"), { timeout: 30000 });
  await sleep(400);

  let options = await readOptions(page);
  check("wizard Step 2 renders exactly 12 options", options.length === 12, `count=${options.length}`);
  check("wizard Step 2 has no Reminders option", !options.some((o) => /reminder/i.test(o)), JSON.stringify(options));
  check("wizard Step 2 counter reads '0 of 12 pages selected'", (await counterText(page)) === "0 of 12 pages selected", await counterText(page));

  // Select All -> 12 checked, then Clear All -> 0
  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Select All")?.click());
  await sleep(250);
  check("Select All checks 12 boxes", (await countChecked(page)) === 12, `checked=${await countChecked(page)}`);
  check("counter reads '12 of 12 pages selected'", (await counterText(page)) === "12 of 12 pages selected", await counterText(page));

  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Clear All")?.click());
  await sleep(250);
  check("Clear All resets to 0 checked", (await countChecked(page)) === 0, `checked=${await countChecked(page)}`);

  await page.screenshot({ path: ".tmp-perm-checklist-step2.png" });

  // pick two and create the staff member
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label")).filter((l) => l.querySelector('input[type="checkbox"]'));
    for (const t of ["Overview / Dashboard", "Patients"]) {
      const lab = labels.find((l) => l.textContent.trim().startsWith(t));
      const input = lab?.querySelector('input[type="checkbox"]');
      if (input && !input.checked) input.click();
    }
  });
  await sleep(250);
  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Create Staff"))?.click());
  const created = await page
    .waitForFunction(() => document.body.textContent.includes("Staff account created."), { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!created) {
    const dump = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 800));
    console.log("CREATE FAILED — body:", dump);
  }
  check("staff member created from the wizard", created);
  await sleep(900);

  /* ---------------- Manage Permissions modal ---------------- */
  if (!created) throw new Error("staff creation failed — skipping Manage Permissions checks");
  const manageBtns = await page.evaluate(() => document.querySelectorAll('button[aria-label^="Manage permissions"]').length);
  check("Manage permissions action available", manageBtns > 0, `n=${manageBtns}`);
  await page.evaluate(() => document.querySelector('button[aria-label^="Manage permissions"]')?.click());
  await page.waitForFunction(() => document.body.textContent.includes("pages selected"), { timeout: 30000 });
  await sleep(400);

  options = await readOptions(page);
  check("Manage Permissions modal renders exactly 12 options", options.length === 12, `count=${options.length}`);
  check("Manage Permissions modal has no Reminders option", !options.some((o) => /reminder/i.test(o)), JSON.stringify(options));
  check("saved 2 grants shown as '2 of 12 pages selected'", (await counterText(page)) === "2 of 12 pages selected", await counterText(page));

  // Scoped to the open modal overlay (the sidebar renders the same 4 headings).
  const groups = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".fixed.inset-0.z-50 p"))
      .map((p) => p.textContent.trim())
      .filter((t) => ["MAIN", "DOCTOR & CLINICS", "PATIENT SERVICES", "MANAGEMENT"].includes(t))
  );
  check("all 4 permission groups render once", groups.length === 4 && new Set(groups).size === 4, JSON.stringify(groups));

  await page.screenshot({ path: ".tmp-perm-checklist-modal.png" });

  check("no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" || "));
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  await browser.close();
}

console.log(results.join("\n"));
const failed = results.filter((l) => l.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
