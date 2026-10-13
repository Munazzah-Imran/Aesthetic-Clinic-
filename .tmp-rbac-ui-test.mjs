/**
 * RBAC / Staff Management UI test (real browser, headless Chrome).
 * Run: node .tmp-rbac-ui-test.mjs   (needs dev server on :3000)
 *
 * Uses the tokens written by .tmp-rbac-api-test.mjs (.tmp-rbac-state.json).
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

async function setToken(page, token) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
}

async function goto(page, path, expectHeading) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  if (expectHeading) {
    await page
      .waitForFunction(
        (needle) => (document.querySelector("h1")?.textContent ?? "").includes(needle),
        { timeout: 60000 },
        expectHeading
      )
      .catch(() => {});
  } else {
    // Wait until the client page mounted (dev-server first-compile can be slow).
    await page
      .waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").length > 0, {
        timeout: 60000,
      })
      .catch(() => {});
  }
}

const h1 = (page) => page.evaluate(() => document.querySelector("h1")?.textContent ?? "NONE");
const sidebarLinks = (page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('nav[aria-label="Dashboard navigation"] a')
    ).map((a) => a.textContent?.trim() ?? "")
  );
const hasText = (page, text) => page.evaluate((t) => document.body.textContent?.includes(t) ?? false, text);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  /* ---------------- ADMIN: staff management page ---------------- */
  await setToken(page, state.ownerToken);

  await goto(page, "/dashboard/staff", "Staff Management");
  check("admin: Staff Management page renders", (await h1(page)).includes("Staff Management"));
  check(
    "admin: exact subtitle shown",
    await hasText(page, "Manage staff members, their accounts, roles, and dashboard access permissions.")
  );
  const adminRows = await page.evaluate(
    () => document.querySelectorAll("tbody tr").length
  );
  check("admin: staff table lists the 2 API-created members", adminRows >= 2, `rows=${adminRows}`);
  check("admin: Talha row visible", await hasText(page, "Talha"));
  check("admin: Staff ID column shows STF code", await hasText(page, "STF-"));
  check("admin: assigned pages summary visible", await hasText(page, "Doctor Profile"));

  const adminSidebar = await sidebarLinks(page);
  check(
    "admin: sidebar unchanged (all 13 items)",
    adminSidebar.length === 13,
    JSON.stringify(adminSidebar)
  );
  await page.screenshot({ path: ".tmp-rbac-staff-page.png" });

  // search by name / staff id / email
  await page.click('input[aria-label="Search staff"]');
  await page.type('input[aria-label="Search staff"]', "Staff Viewer");
  await new Promise((r) => setTimeout(r, 400));
  let rows = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("admin: search by name filters to 1 row", rows === 1, `rows=${rows}`);
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search staff"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // search by staff ID: read a real STF code from the table, then filter on it
  const staffCode = await page.evaluate(
    () => document.querySelector("tbody tr td.font-mono")?.textContent?.trim() ?? ""
  );
  await page.type('input[aria-label="Search staff"]', staffCode);
  await new Promise((r) => setTimeout(r, 400));
  rows = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("admin: search by staff ID finds that member", rows === 1 && staffCode.startsWith("STF-"),
    `rows=${rows} code=${staffCode}`);
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search staff"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));

  /* ---------------- ADMIN: Add Staff flow ---------------- */
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add Staff")
    );
    btn?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 15000 });
  check("admin: Add Staff modal opens", true);

  // Required-field validation (frontend guard) — submit empty.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create Staff")
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  check(
    "admin: empty form blocked with field errors",
    await hasText(page, "Full name is required")
  );

  // Fill details
  await page.type("#staff-full-name", "UI Staff Member");
  await page.type("#staff-email", `rbac-ui-${state.stamp}@example.com`);
  await page.type("#staff-phone", "0301-9998877");

  // Designation dropdown (FormSelect: custom listbox)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]'))[0];
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.trim().startsWith("Nurse")
    );
    opt?.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // Login account setup
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);

  // Permissions: Select All -> 21 checked, Clear All -> 0, then pick 2.
  const countChecked = () =>
    page.evaluate(
      () => document.querySelectorAll('input[type="checkbox"]:checked').length
    );
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Select All"
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 200));
  const allChecked = await countChecked();
  check("admin: Select All checks every permission", allChecked >= 21, `checked=${allChecked}`);

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Clear All"
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 200));
  const noneChecked = await countChecked();
  check("admin: Clear All clears only the form selection", noneChecked === 0, `checked=${noneChecked}`);

  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label"));
    const targets = ["Overview / Dashboard", "Patients"];
    for (const t of targets) {
      const lab = labels.find((l) => l.textContent?.trim().startsWith(t));
      const input = lab?.querySelector('input[type="checkbox"]');
      if (input && !input.checked) input.click();
    }
  });
  await new Promise((r) => setTimeout(r, 200));
  check("admin: picked exactly 2 permissions", (await countChecked()) === 2);

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create Staff")
    );
    btn?.click();
  });
  const created = await page
    .waitForFunction(
      () => document.body.textContent?.includes("Staff account created.") === true,
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("admin: create succeeds with success toast", created);
  await new Promise((r) => setTimeout(r, 800));
  check("admin: new staff row appears in table", await hasText(page, "UI Staff Member"));
  check(
    "admin: new staff row shows its 2 assigned pages",
    await hasText(page, "Overview / Dashboard, Patients")
  );

  // Duplicate submission handled safely: reopen and create duplicate email
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add Staff")
    );
    btn?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 15000 });
  await page.type("#staff-full-name", "UI Staff Duplicate");
  await page.type("#staff-email", `rbac-ui-${state.stamp}@example.com`);
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);
  // designation = Receptionist (custom FormSelect listbox)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]'))[0];
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find((o) =>
      o.textContent?.trim().startsWith("Receptionist")
    );
    opt?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create Staff")
    );
    btn?.click();
  });
  const dupBlocked = await page
    .waitForFunction(
      () => document.body.textContent?.includes("already exists") === true,
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("admin: duplicate email blocked with visible error", dupBlocked);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-label="Close"]'))[0];
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  /* ---------------- ADMIN: existing modules still render ---------------- */
  const smoke = [
    ["/dashboard", "Dashboard"],
    ["/dashboard/patients", null],
    ["/dashboard/appointments", null],
    ["/dashboard/services", null],
  ];
  for (const [path, heading] of smoke) {
    pageErrors.length = 0;
    await goto(page, path, heading);
    const headingText = await h1(page);
    const denied = await hasText(page, "Access Denied");
    check(
      `existing module renders: ${path}`,
      !denied && headingText !== "NONE" && pageErrors.length === 0,
      `h1="${headingText}" errors=${pageErrors.slice(0, 2).join(" || ")}`
    );
  }

  /* ---------------- STAFF: sidebar filtering + access denied ---------------- */
  await setToken(page, state.staffToken);
  pageErrors.length = 0;

  await goto(page, "/dashboard/doctors", null);
  const staffSidebar = await sidebarLinks(page);
  check(
    "staff: sidebar shows ONLY granted modules (Doctor Profile, Clinics)",
    staffSidebar.length === 2 &&
      staffSidebar.includes("Doctor Profile") &&
      staffSidebar.includes("Clinics"),
    JSON.stringify(staffSidebar)
  );
  check(
    "staff: no unauthorized sidebar labels",
    !(await hasText(page, "Appointments")) &&
      !(staffSidebar.includes("Patients")) &&
      !(staffSidebar.includes("Staff")) &&
      !(staffSidebar.includes("Reminders"))
  );
  check(
    "staff: navbar hides unauthorized Settings + Reminders links",
    (await page.evaluate(() => document.querySelectorAll('a[aria-label="Settings"]').length)) === 0 &&
      (await page.evaluate(() => document.querySelectorAll('a[aria-label="Notifications"]').length)) === 0
  );
  check("staff: granted Doctor Profile page renders", (await h1(page)) !== "NONE" && !(await hasText(page, "Access Denied")));
  check("staff: sidebar chip shows role, not Administrator", !(await hasText(page, "Administrator")));
  check("staff: page loads without JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" || "));

  // Direct URL to unauthorized pages -> Access Denied
  for (const path of ["/dashboard/patients", "/dashboard/staff", "/dashboard/appointments", "/dashboard/settings"]) {
    pageErrors.length = 0;
    await goto(page, path, "Access Denied");
    const heading = await h1(page);
    check(`staff: direct URL ${path} -> Access Denied`, heading.includes("Access Denied") && pageErrors.length === 0,
      `h1="${heading}"`);
  }
  await page.screenshot({ path: ".tmp-rbac-access-denied.png" });

  // "Go to my dashboard" recovers to a granted module
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Go to my dashboard")
    );
    link?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const recoveredUrl = page.url();
  check(
    "staff: Access Denied recovers to a granted module",
    recoveredUrl.includes("/dashboard/doctors") && !(await hasText(page, "Access Denied")),
    recoveredUrl
  );

  /* ---------------- VIEWER: staff-permission member ---------------- */
  await setToken(page, state.viewerToken);
  await goto(page, "/dashboard/staff", "Staff Management");
  const viewerSidebar = await sidebarLinks(page);
  check(
    "viewer: sidebar shows Overview + Staff only",
    viewerSidebar.length === 2 && viewerSidebar.includes("Overview") && viewerSidebar.includes("Staff"),
    JSON.stringify(viewerSidebar)
  );
  check("viewer: can open Staff page (granted)", (await h1(page)).includes("Staff Management"));
  const viewerSeesAdd = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Add Staff"))
  );
  check("viewer: Add Staff button hidden for non-admin", !viewerSeesAdd);
  const viewerActionButtons = await page.evaluate(
    () => document.querySelectorAll('button[aria-label^="Manage permissions"]').length
  );
  check("viewer: permission management actions hidden for non-admin", viewerActionButtons === 0, `n=${viewerActionButtons}`);

  /* ---------------- staff login screen still works (existing flow) ---------------- */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const loginOk = await page.evaluate(() => document.querySelector(".auth-title")?.textContent ?? "");
  check("existing admin login flow untouched", loginOk.includes("Welcome to Clinic"), loginOk);
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  await browser.close();
}

console.log("\n" + results.join("\n"));
const failed = results.filter((l) => l.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
