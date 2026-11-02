/**
 * End-to-end RBAC flow verification (API + real browser).
 * Run: node .tmp-rbac-flow-test.mjs   (needs dev server on :3000)
 *
 * Covers the requested flow:
 *   1. New business signup -> first user is admin with EVERY permission
 *   2. Admin creates a staff account with a subset of permissions
 *   3. Staff can access/see ONLY the granted items (sidebar + API 403s)
 *   4. A second business is fully isolated from the first
 *   5. The unauthenticated starter /api/todos endpoint is gone
 */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stamp = Date.now();

const CATALOG = [
  "overview", "appointments", "calendar", "patients",
  "doctor_profile", "clinics", "weekly_schedule", "off_days",
  "special_schedules", "blocked_slots", "services", "emergency_alerts",
  "staff_inbox", "human_handover", "staff", "audit_logs",
  "system_health", "settings",
].sort();

const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** signup -> login -> clear the forced first-login password change. */
async function createOwner(biz, name) {
  const email = `${biz.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@example.com`;
  const password = `Owner-${stamp}-Pass`;
  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: { businessName: `${biz} ${stamp}`, name, email, password },
  });
  if (!signup.json?.success) throw new Error(`signup failed: ${JSON.stringify(signup.json)}`);
  const login = await api("/api/auth/login", { method: "POST", body: { email, password } });
  if (!login.json?.success) throw new Error(`login failed: ${JSON.stringify(login.json)}`);
  const token = login.json.data.token;
  const next = `${password}-X9`;
  const patch = await api("/api/password", {
    token, method: "PATCH",
    body: { currentPassword: password, newPassword: next, confirmPassword: next },
  });
  if (!patch.json?.success) throw new Error(`password change failed: ${JSON.stringify(patch.json)}`);
  return { token, email, password: next };
}

async function login(email, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { email, password } });
  if (!res.json?.success) throw new Error(`login failed: ${JSON.stringify(res.json)}`);
  return res.json.data.token;
}

/** Staff accounts must change their initial password before any API works. */
async function activateStaff(email, initialPassword) {
  const token = await login(email, initialPassword);
  // /api/auth/permissions is allowlisted during the forced change — probe a
  // regular module endpoint instead.
  const blocked = await api("/api/patients", { token });
  const forced = blocked.status === 403 && /set a new password/i.test(blocked.json?.message ?? "");
  const next = `${initialPassword}-X9`;
  const patch = await api("/api/password", {
    token, method: "PATCH",
    body: { currentPassword: initialPassword, newPassword: next, confirmPassword: next },
  });
  if (!patch.json?.success) throw new Error(`staff password change failed: ${JSON.stringify(patch.json)}`);
  return { token, forced, password: next };
}

const patientPayload = (fullName) => ({
  fullName, gender: "Male", dateOfBirth: "1990-04-12",
  maritalStatus: "Single", phone: "0300-1234567", city: "Karachi",
});

/* =========================== API FLOW =========================== */
try {
  // ---- 1. New business: first user is admin with ALL permissions ----
  const ownerA = await createOwner("Alpha Clinic", "Alpha Owner");
  const permsA = await api("/api/auth/permissions", { token: ownerA.token });
  check("A: owner resolves as admin", permsA.json?.data?.isAdmin === true, JSON.stringify(permsA.json?.data?.role));
  check(
    "A: owner holds EVERY catalog permission (18)",
    JSON.stringify([...permsA.json.data.permissions].sort()) === JSON.stringify(CATALOG),
    `n=${permsA.json.data.permissions.length}`
  );

  const createdPatientA = await api("/api/patients", {
    token: ownerA.token, method: "POST",
    body: patientPayload("Alpha Tenant Patient"),
  });
  check("A: owner can create data (patient)", createdPatientA.status === 201 && createdPatientA.json?.success,
    `status=${createdPatientA.status}`);
  const patientAId = createdPatientA.json?.data?.id;

  // ---- 2. Admin creates a staff account with a subset ----
  const staffEmail = `staff-alpha-${stamp}@example.com`;
  const staffPassword = `Staff-${stamp}-Pass`;
  const granted = ["overview", "patients"];
  const createdStaff = await api("/api/staff", {
    token: ownerA.token, method: "POST",
    body: {
      fullName: "Alpha Restricted", email: staffEmail, designation: "Nurse",
      accountStatus: "active", password: staffPassword, confirmPassword: staffPassword,
      permissions: granted,
    },
  });
  check("A: admin creates a staff account", createdStaff.status === 201 && createdStaff.json?.success,
    `status=${createdStaff.status} ${createdStaff.json?.message ?? ""} errors=${JSON.stringify(createdStaff.json?.data?.errors ?? null)}`);
  check("A: created account is role=staff (never admin)",
    createdStaff.json?.data?.role === "staff", JSON.stringify(createdStaff.json?.data?.role));
  const staffAId = createdStaff.json?.data?.id;

  const ownerStaffList = await api("/api/staff", { token: ownerA.token });
  check("A: admin sees own staff list", JSON.stringify(ownerStaffList.json?.data ?? []).includes(staffEmail));

  // ---- 3. Staff access = exactly the granted subset ----
  const { token: staffToken, forced } = await activateStaff(staffEmail, staffPassword);
  check("staff: forced first-login password change enforced", forced);

  const staffPerms = await api("/api/auth/permissions", { token: staffToken });
  check("staff: isAdmin=false", staffPerms.json?.data?.isAdmin === false);
  check("staff: permissions == granted subset only",
    JSON.stringify([...staffPerms.json.data.permissions].sort()) === JSON.stringify([...granted].sort()),
    JSON.stringify(staffPerms.json.data.permissions));

  const allowed = [
    ["/api/dashboard", "GET"], ["/api/patients", "GET"],
  ];
  for (const [path, method] of allowed) {
    const r = await api(path, { token: staffToken, method });
    check(`staff ALLOWED: ${method} ${path}`, r.status === 200, `status=${r.status}`);
  }
  const denied = [
    ["/api/settings", "GET"], ["/api/services", "GET"], ["/api/appointments", "GET"],
    ["/api/clinics", "GET"], ["/api/doctors", "GET"], ["/api/emergency-alerts", "GET"],
    // "staff" is non-assignable: the Staff module is admin-only by catalog design.
    ["/api/staff", "GET"],
  ];
  for (const [path, method] of denied) {
    const r = await api(path, { token: staffToken, method });
    check(`staff DENIED: ${method} ${path}`, r.status === 403, `status=${r.status}`);
  }
  const staffMutate = await api("/api/staff", {
    token: staffToken, method: "POST",
    body: { fullName: "X", email: `x-${stamp}@example.com`, designation: "Nurse",
      accountStatus: "active", password: staffPassword, confirmPassword: staffPassword, permissions: [] },
  });
  check("staff DENIED: POST /api/staff (admin-only mutation)",
    staffMutate.status === 403 && /administrator/i.test(staffMutate.json?.message ?? ""),
    `status=${staffMutate.status} ${staffMutate.json?.message ?? ""}`);
  const staffPatch = await api(`/api/staff/${staffAId}`, {
    token: staffToken, method: "PATCH", body: { fullName: "Hacked" },
  });
  check("staff DENIED: PATCH /api/staff/[id] (admin-only mutation)", staffPatch.status === 403,
    `status=${staffPatch.status}`);

  // ---- unauthenticated ----
  const anon1 = await api("/api/patients");
  const anon2 = await api("/api/dashboard");
  check("anon DENIED: GET /api/patients -> 401", anon1.status === 401, `status=${anon1.status}`);
  check("anon DENIED: GET /api/dashboard -> 401", anon2.status === 401, `status=${anon2.status}`);

  // ---- 4. Second business: fully isolated ----
  const ownerB = await createOwner("Beta Clinic", "Beta Owner");
  const permsB = await api("/api/auth/permissions", { token: ownerB.token });
  check("B: new business owner is admin with all permissions",
    permsB.json?.data?.isAdmin === true &&
    JSON.stringify([...permsB.json.data.permissions].sort()) === JSON.stringify(CATALOG));

  const createdPatientB = await api("/api/patients", {
    token: ownerB.token, method: "POST",
    body: patientPayload("Beta Tenant Patient"),
  });
  check("B: owner can create its own data", createdPatientB.status === 201,
    `status=${createdPatientB.status}`);
  const patientBId = createdPatientB.json?.data?.id;

  const listB = await api("/api/patients", { token: ownerB.token });
  const listBText = JSON.stringify(listB.json?.data ?? []);
  check("B: sees ONLY its own patient", listBText.includes("Beta Tenant Patient") && !listBText.includes("Alpha Tenant Patient"));

  const listAasStaff = await api("/api/patients", { token: staffToken });
  const listAasStaffText = JSON.stringify(listAasStaff.json?.data ?? []);
  check("staff of A: sees A's patient but never B's",
    listAasStaffText.includes("Alpha Tenant Patient") && !listAasStaffText.includes("Beta Tenant Patient"));

  const crossGet = await api(`/api/patients/${patientAId}`, { token: ownerB.token });
  const crossPatch = await api(`/api/patients/${patientAId}`, { token: ownerB.token, method: "PATCH", body: { fullName: "Owned" } });
  const crossDelete = await api(`/api/patients/${patientAId}`, { token: ownerB.token, method: "DELETE" });
  check("B: cross-tenant GET patient -> 404", crossGet.status === 404, `status=${crossGet.status}`);
  check("B: cross-tenant PATCH patient -> 404", crossPatch.status === 404, `status=${crossPatch.status}`);
  check("B: cross-tenant DELETE patient -> 404", crossDelete.status === 404, `status=${crossDelete.status}`);

  const staffListB = await api("/api/staff", { token: ownerB.token });
  check("B: staff list never contains A's staff",
    !JSON.stringify(staffListB.json?.data ?? []).includes(staffEmail));
  const crossStaffPatch = await api(`/api/staff/${staffAId}`, {
    token: ownerB.token, method: "PATCH", body: { fullName: "Stolen" },
  });
  check("B: cross-tenant PATCH A's staff -> 404", crossStaffPatch.status === 404, `status=${crossStaffPatch.status}`);
  const crossStaffPerms = await api(`/api/staff/${staffAId}/permissions`, { token: ownerB.token });
  check("B: cross-tenant read A's staff permissions -> 404", crossStaffPerms.status === 404,
    `status=${crossStaffPerms.status}`);

  // Sanity: A's patient still intact after B's attempts
  const listA = await api("/api/patients", { token: ownerA.token });
  check("A: patient untouched by cross-tenant attempts",
    JSON.stringify(listA.json?.data ?? []).includes("Alpha Tenant Patient"));

  // ---- 5. Starter leftovers are gone ----
  const t1 = await api("/api/todos");
  const t2 = await api("/api/todos", { method: "POST", body: { title: "x" } });
  const t3 = await api("/api/todos/1", { method: "PATCH", body: { done: true } });
  check("removed: GET /api/todos -> 404", t1.status === 404, `status=${t1.status}`);
  check("removed: POST /api/todos -> 404", t2.status === 404, `status=${t2.status}`);
  check("removed: PATCH /api/todos/1 -> 404", t3.status === 404, `status=${t3.status}`);

  const root = await fetch(`${BASE}/`, { redirect: "manual" });
  check("root / redirects to /dashboard",
    [307, 308].includes(root.status) && (root.headers.get("location") ?? "").includes("/dashboard"),
    `status=${root.status} location=${root.headers.get("location")}`);

  /* =========================== BROWSER UI =========================== */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.setViewport({ width: 1400, height: 950 });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    const setTokenAndGo = async (token, path) => {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate((t) => localStorage.setItem("token", t), token);
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").length > 0, { timeout: 60000 });
    };
    const sidebar = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('nav[aria-label="Dashboard navigation"] a')).map((a) => a.textContent.trim())
      );
    const denied = () => page.evaluate(() => (document.querySelector("h1")?.textContent ?? "").includes("Access Denied"));
    const bodyText = () => page.evaluate(() => document.body.innerText);

    // Owner A: full sidebar, no Access Denied on admin pages
    await setTokenAndGo(ownerA.token, "/dashboard/staff");
    const ownerSide = await sidebar();
    check("UI owner A: full 12-module sidebar", ownerSide.length === 12, JSON.stringify(ownerSide));
    check("UI owner A: /dashboard/staff not denied", !(await denied()));
    check("UI owner A: sees the Staff module", ownerSide.includes("Staff"));

    // Staff A: only granted modules, Access Denied elsewhere, no B data
    await setTokenAndGo(staffToken, "/dashboard");
    const staffSide = await sidebar();
    check("UI staff: sidebar shows ONLY granted modules",
      JSON.stringify(staffSide) === JSON.stringify(["Overview", "Patients"]), JSON.stringify(staffSide));

    await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").length > 0, { timeout: 60000 });
    check("UI staff: /dashboard/settings -> Access Denied", await denied());

    await page.goto(`${BASE}/dashboard/services`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").length > 0, { timeout: 60000 });
    check("UI staff: /dashboard/services -> Access Denied", await denied());

    await page.goto(`${BASE}/dashboard/patients`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").length > 0, { timeout: 60000 });
    await sleep(1500);
    const patientsDenied = await denied();
    const text = await bodyText();
    check("UI staff: /dashboard/patients renders (granted)", !patientsDenied);
    check("UI staff: sees own tenant's patient", text.includes("Alpha Tenant Patient"));
    check("UI staff: never sees the other tenant's patient", !text.includes("Beta Tenant Patient"));
    await page.screenshot({ path: ".tmp-rbac-flow-staff.png" });

    check("UI: no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" || "));
  } catch (err) {
    const diag = page
      ? `url=${page.url()} h1=${await page.evaluate(() => document.querySelector("h1")?.textContent ?? "NONE").catch(() => "?")} body=${await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "?")}`
      : "(no page)";
    check("UNEXPECTED ERROR", false, `${String(err?.message ?? err)} || ${diag}`);
  } finally {
    await browser.close();
  }
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
}

console.log(results.join("\n"));
const failed = results.filter((l) => l.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
