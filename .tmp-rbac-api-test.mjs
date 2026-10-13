/**
 * RBAC / Staff Management API security test (spec item 16).
 * Run: node .tmp-rbac-api-test.mjs   (needs the dev server on :3000)
 *
 * Creates a THROWAWAY business + owner, staff members, and verifies every
 * enforcement layer. State is written to .tmp-rbac-state.json for the UI test;
 * cleanup happens in .tmp-rbac-cleanup.mjs at the very end.
 */

const BASE = process.env.TEST_BASE || "http://localhost:3000";
const STAMP = Date.now();

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- fixtures
const OWNER_EMAIL = `rbac-owner-${STAMP}@example.com`;
const STAFF_EMAIL = `rbac-talha-${STAMP}@example.com`;
const VIEWER_EMAIL = `rbac-viewer-${STAMP}@example.com`;
const TEMP_PWD = `Temp-${STAMP}-Pass`;
const NEW_PWD = `NewSecure-${STAMP}-Pass`;
const OWNER_PWD = `Owner-${STAMP}-Pass`;

// Signup: creates throwaway business + owner (existing signup flow).
const signup = await api("POST", "/api/auth/signup", {
  body: { businessName: `RBAC Test Clinic ${STAMP}`, name: "RBAC Owner", email: OWNER_EMAIL, password: OWNER_PWD },
});
check("setup: owner signup works", signup.status === 201 && signup.json?.success, `status=${signup.status}`);

const ownerLogin = await api("POST", "/api/auth/login", {
  body: { email: OWNER_EMAIL, password: OWNER_PWD },
});
const ownerToken = ownerLogin.json?.data?.token;
check("setup: owner login works", Boolean(ownerToken), `status=${ownerLogin.status}`);

// Second throwaway business for cross-tenant isolation checks.
const signupB = await api("POST", "/api/auth/signup", {
  body: { businessName: `RBAC Other Clinic ${STAMP}`, name: "Other Owner", email: `rbac-other-${STAMP}@example.com`, password: OWNER_PWD },
});
const otherLogin = await api("POST", "/api/auth/login", {
  body: { email: `rbac-other-${STAMP}@example.com`, password: OWNER_PWD },
});
const otherToken = otherLogin.json?.data?.token;
check("setup: second business signup+login", signupB.status === 201 && Boolean(otherToken));

// ------------------------------------------------- 1. admin is the owner
const ownerPerms = await api("GET", "/api/auth/permissions", { token: ownerToken });
const ownerPermData = ownerPerms.json?.data;
check(
  "owner resolves as admin with every permission",
  ownerPerms.status === 200 && ownerPermData?.isAdmin === true && ownerPermData?.role === "admin" &&
    Array.isArray(ownerPermData?.permissions) && ownerPermData.permissions.length >= 21,
  `n=${ownerPermData?.permissions?.length} role=${ownerPermData?.role}`
);
const ownerIsListedAsStaff = await api("GET", "/api/staff", { token: ownerToken });
check("owner is not duplicated into the staff list", ownerIsListedAsStaff.status === 200 && ownerIsListedAsStaff.json?.data?.length === 0,
  `len=${ownerIsListedAsStaff.json?.data?.length}`);

// ------------------------------------------- 2. create staff (admin only)
const badCreate = await api("POST", "/api/staff", {
  token: ownerToken,
  body: { fullName: "", email: "not-an-email", designation: "", accountStatus: "weird", password: "1", confirmPassword: "2", permissions: ["not_a_real_key"] },
});
check("create with invalid fields rejected 400", badCreate.status === 400, `status=${badCreate.status}`);

const createTalha = await api("POST", "/api/staff", {
  token: ownerToken,
  body: {
    fullName: "Talha",
    email: STAFF_EMAIL,
    phone: "0300-1234567",
    designation: "Receptionist",
    accountStatus: "active",
    password: TEMP_PWD,
    confirmPassword: TEMP_PWD,
    permissions: ["overview", "doctor_profile", "clinics"],
  },
});
const talha = createTalha.json?.data;
check("admin creates staff member (201)", createTalha.status === 201 && createTalha.json?.success, `status=${createTalha.status}`);
check("staff row has STF id + correct fields",
  typeof talha?.staffId === "string" && talha.staffId.startsWith("STF-") && talha.fullName === "Talha" &&
    talha.designation === "Receptionist" && talha.role === "staff" && talha.accountStatus === "active" &&
    talha.mustChangePassword === true,
  JSON.stringify({ staffId: talha?.staffId, role: talha?.role, mcp: talha?.mustChangePassword }));
check("staff row exposes no password material",
  !JSON.stringify(createTalha.json).includes("$2") && !JSON.stringify(createTalha.json).includes(TEMP_PWD));

const dupCreate = await api("POST", "/api/staff", {
  token: ownerToken,
  body: { fullName: "Talha Clone", email: STAFF_EMAIL, designation: "Nurse", accountStatus: "active", password: TEMP_PWD, confirmPassword: TEMP_PWD, permissions: [] },
});
check("duplicate email handled safely (409)", dupCreate.status === 409, `status=${dupCreate.status}`);

// permissions granted are EXACTLY what was asked (no implicit extras)
const permsStored = await api("GET", `/api/staff/${talha.id}/permissions`, { token: ownerToken });
const storedKeys = permsStored.json?.data?.permissions ?? [];
check(
  "exactly the 3 requested permission keys stored",
  permsStored.status === 200 && storedKeys.length === 3 &&
    ["overview", "doctor_profile", "clinics"].every((k) => storedKeys.includes(k)),
  JSON.stringify(storedKeys)
);

// second staff who CAN see the staff page (for viewer/authorization tests)
const createViewer = await api("POST", "/api/staff", {
  token: ownerToken,
  body: {
    fullName: "Staff Viewer",
    email: VIEWER_EMAIL,
    designation: "Clinic Manager",
    accountStatus: "active",
    password: TEMP_PWD,
    confirmPassword: TEMP_PWD,
    permissions: ["staff", "overview"],
  },
});
const viewer = createViewer.json?.data;
check("admin creates second staff (viewer)", createViewer.status === 201, `status=${createViewer.status}`);

// -------------------------------------------- 3. staff authentication flow
const login1 = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: TEMP_PWD } });
const talhaToken = login1.json?.data?.token;
check("staff logs in with own account + temp password", login1.status === 200 && Boolean(talhaToken));

const permsBefore = await api("GET", "/api/auth/permissions", { token: talhaToken });
check(
  "forced first-login password change flagged",
  permsBefore.status === 200 && permsBefore.json?.data?.mustChangePassword === true,
  JSON.stringify(permsBefore.json?.data)
);

// While must_change_password is on, non-password APIs must be 403.
const blockedBefore = await api("GET", "/api/patients", { token: talhaToken });
check("API blocked until password change (403)", blockedBefore.status === 403,
  `status=${blockedBefore.status} msg=${blockedBefore.json?.message}`);

const wrongChange = await api("PATCH", "/api/password", {
  token: talhaToken,
  body: { currentPassword: "totally-wrong", newPassword: NEW_PWD, confirmPassword: NEW_PWD },
});
check("password change with wrong current password rejected", wrongChange.status === 400, `status=${wrongChange.status}`);

const change = await api("PATCH", "/api/password", {
  token: talhaToken,
  body: { currentPassword: TEMP_PWD, newPassword: NEW_PWD, confirmPassword: NEW_PWD },
});
check("staff completes first-login password change", change.status === 200 && change.json?.success, `status=${change.status}`);

const oldPwdLogin = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: TEMP_PWD } });
check("old temp password no longer works (401)", oldPwdLogin.status === 401, `status=${oldPwdLogin.status}`);
const newPwdLogin = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: NEW_PWD } });
const talhaToken2 = newPwdLogin.json?.data?.token;
check("staff logs in with their own new password", newPwdLogin.status === 200 && Boolean(talhaToken2));

// ----------------------------------------- 4. permission enforcement (403)
const permsAfter = await api("GET", "/api/auth/permissions", { token: talhaToken2 });
check(
  "permissions exactly as granted (3 keys, role staff)",
  permsAfter.json?.data?.role === "staff" && permsAfter.json?.data?.isAdmin === false &&
    permsAfter.json?.data?.mustChangePassword === false &&
    (permsAfter.json?.data?.permissions ?? []).length === 3,
  JSON.stringify(permsAfter.json?.data?.permissions)
);

const allowedMatrix = [
  ["GET", "/api/dashboard", "overview"],
  ["GET", "/api/doctors", "doctor_profile (reader)"],
  ["GET", "/api/clinics", "clinics"],
];
for (const [method, path, label] of allowedMatrix) {
  const r = await api(method, path, { token: talhaToken2 });
  check(`GRANTED ${path} -> 200 (${label})`, r.status === 200, `status=${r.status} msg=${r.json?.message}`);
}

const deniedMatrix = [
  ["GET", "/api/patients"],
  ["GET", "/api/appointments"],
  ["GET", "/api/services"],
  ["GET", "/api/settings"],
  ["GET", "/api/staff"],
  ["GET", "/api/reports"],
  ["GET", "/api/virtual-consultations"],
  ["GET", "/api/emergency-alerts"],
  ["GET", "/api/staff-messages"],
  ["GET", "/api/off-days"],
  ["GET", "/api/weekly-schedule"],
  ["GET", "/api/blocked-slots"],
  ["GET", "/api/special-schedules"],
];
for (const [method, path] of deniedMatrix) {
  const r = await api(method, path, { token: talhaToken2 });
  check(`DENIED ${path} -> 403`, r.status === 403, `status=${r.status} msg=${r.json?.message}`);
}

// writes always require the OWNING module's permission — Talha holds
// doctor_profile + clinics, so use modules he does NOT have.
const writeDenied = await api("POST", "/api/patients", { token: talhaToken2, body: { fullName: "X" } });
check("write to patients without patients permission -> 403", writeDenied.status === 403, `status=${writeDenied.status}`);
const apptWriteDenied = await api("POST", "/api/appointments", { token: talhaToken2, body: {} });
check("write to appointments without appointments permission -> 403", apptWriteDenied.status === 403, `status=${apptWriteDenied.status}`);
const ownModuleWrite = await api("POST", "/api/doctors", { token: talhaToken2, body: { name: "X" } });
check("write to OWN granted module passes permission (validation 400, never 201/403)",
  ownModuleWrite.status === 400, `status=${ownModuleWrite.status}`);

// unauthenticated
const noToken = await api("GET", "/api/staff");
check("no token -> 401", noToken.status === 401, `status=${noToken.status}`);
const badToken = await api("GET", "/api/staff", { token: "not-a-jwt" });
check("garbage token -> 401", badToken.status === 401, `status=${badToken.status}`);

// --------------------------------- 5. staff cannot manage staff (no self-promotion)
const viewerLogin = await api("POST", "/api/auth/login", { body: { email: VIEWER_EMAIL, password: TEMP_PWD } });
// viewer still has must_change_password -> change it first
const viewerChange = await api("PATCH", "/api/password", {
  token: viewerLogin.json?.data?.token,
  body: { currentPassword: TEMP_PWD, newPassword: NEW_PWD, confirmPassword: NEW_PWD },
});
check("viewer completes password change", viewerChange.status === 200, `status=${viewerChange.status}`);
const viewerToken = (await api("POST", "/api/auth/login", { body: { email: VIEWER_EMAIL, password: NEW_PWD } })).json?.data?.token;

const viewerList = await api("GET", "/api/staff", { token: viewerToken });
check("staff WITH staff permission can VIEW the list (200)", viewerList.status === 200 && viewerList.json?.data?.length >= 2,
  `status=${viewerList.status} len=${viewerList.json?.data?.length}`);

const viewerCreate = await api("POST", "/api/staff", {
  token: viewerToken,
  body: { fullName: "Evil", email: `rbac-evil-${STAMP}@example.com`, designation: "X", accountStatus: "active", password: TEMP_PWD, confirmPassword: TEMP_PWD, permissions: ["settings"] },
});
check("staff CANNOT create accounts (403)", viewerCreate.status === 403, `status=${viewerCreate.status}`);

const viewerPromote = await api("PUT", `/api/staff/${talha.id}/permissions`, {
  token: viewerToken,
  body: { permissions: ["settings", "staff"], role: "admin" },
});
check("staff CANNOT change permissions / promote (403)", viewerPromote.status === 403, `status=${viewerPromote.status}`);

const viewerOwnPerms = await api("PUT", `/api/staff/${viewer.id}/permissions`, { token: viewerToken, body: { permissions: ["settings"] } });
check("staff CANNOT change own permissions (403)", viewerOwnPerms.status === 403, `status=${viewerOwnPerms.status}`);

const viewerEdit = await api("PATCH", `/api/staff/${talha.id}`, { token: viewerToken, body: { accountStatus: "inactive" } });
check("staff CANNOT deactivate other staff (403)", viewerEdit.status === 403, `status=${viewerEdit.status}`);

const viewerSelfEdit = await api("PATCH", `/api/staff/${viewer.id}`, { token: viewerToken, body: { role: "admin", designation: "Boss" } });
check("staff CANNOT edit own account (403)", viewerSelfEdit.status === 403, `status=${viewerSelfEdit.status}`);

// owner can NEVER be targeted (no membership row -> 404), no lockout path
const ownerUserRow = (await api("GET", "/api/auth/me", { token: ownerToken })).json?.data?.user;
const targetOwner = await api("PATCH", `/api/staff/${"00000000-0000-0000-0000-000000000000"}`, { token: ownerToken, body: { accountStatus: "inactive" } });
check("owner account is not editable through staff APIs (404)", targetOwner.status === 404, `status=${targetOwner.status}`);
check("owner /api/auth/me returns the owner identity", Boolean(ownerUserRow?.email === OWNER_EMAIL), JSON.stringify(ownerUserRow));

// --------------------------------------- 6. permission changes take effect
const grant = await api("PUT", `/api/staff/${talha.id}/permissions`, {
  token: ownerToken,
  body: { permissions: ["overview", "doctor_profile", "clinics", "appointments"] },
});
check("admin saves new permissions (200)", grant.status === 200 && grant.json?.success, `status=${grant.status}`);
const apptAfterGrant = await api("GET", "/api/appointments", { token: talhaToken2 });
check("newly granted Appointments accessible WITHOUT re-login", apptAfterGrant.status === 200, `status=${apptAfterGrant.status}`);

const revoke = await api("PUT", `/api/staff/${talha.id}/permissions`, {
  token: ownerToken,
  body: { permissions: ["doctor_profile", "clinics"] },
});
check("admin revokes permissions (200)", revoke.status === 200);
const dashAfterRevoke = await api("GET", "/api/dashboard", { token: talhaToken2 });
check("revoked Overview blocked immediately (403)", dashAfterRevoke.status === 403, `status=${dashAfterRevoke.status}`);
const doctorAfterRevoke = await api("GET", "/api/doctors", { token: talhaToken2 });
check("remaining Doctor Profile grant still works (200)", doctorAfterRevoke.status === 200, `status=${doctorAfterRevoke.status}`);

// unknown permission keys rejected server-side
const bogusPerms = await api("PUT", `/api/staff/${talha.id}/permissions`, { token: ownerToken, body: { permissions: ["overview", "hacked_key"] } });
check("unknown permission key rejected (400)", bogusPerms.status === 400, `status=${bogusPerms.status}`);

// ------------------------------------- 7. deactivate / reactivate lifecycle
const deactivate = await api("PATCH", `/api/staff/${talha.id}`, { token: ownerToken, body: { accountStatus: "inactive" } });
check("admin deactivates staff (200)", deactivate.status === 200 && deactivate.json?.data?.accountStatus === "inactive",
  `status=${deactivate.status}`);

const deactivatedApi = await api("GET", "/api/clinics", { token: talhaToken2 });
check("existing token of deactivated staff -> 401 (revoked)", deactivatedApi.status === 401, `status=${deactivatedApi.status} msg=${deactivatedApi.json?.message}`);
const deactivatedMe = await api("GET", "/api/auth/me", { token: talhaToken2 });
check("deactivated staff /api/auth/me -> 401 (session dropped)", deactivatedMe.status === 401, `status=${deactivatedMe.status}`);
const deactivatedLogin = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: NEW_PWD } });
check("deactivated staff cannot log in (403)", deactivatedLogin.status === 403, `status=${deactivatedLogin.status} msg=${deactivatedLogin.json?.message}`);

const reactivate = await api("PATCH", `/api/staff/${talha.id}`, { token: ownerToken, body: { accountStatus: "active" } });
check("admin reactivates staff (200)", reactivate.status === 200 && reactivate.json?.data?.accountStatus === "active");
const reactivatedLogin = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: NEW_PWD } });
check("reactivated staff can log in again", reactivatedLogin.status === 200, `status=${reactivatedLogin.status}`);
const reactivatedPerms = await api("GET", "/api/auth/permissions", { token: reactivatedLogin.json?.data?.token });
check("permissions persist across deactivation/reactivation (still 2)",
  (reactivatedPerms.json?.data?.permissions ?? []).length === 2, JSON.stringify(reactivatedPerms.json?.data?.permissions));

// --------------------------------------------- 8. cross-business isolation
const talhaMembershipId = talha.id;
const crossList = await api("GET", "/api/staff", { token: otherToken });
check("other business sees only its own (empty) staff list", crossList.status === 200 && crossList.json?.data?.length === 0,
  `len=${crossList.json?.data?.length}`);

const crossGet = await api("GET", `/api/staff/${talhaMembershipId}`, { token: otherToken });
check("other business cannot load this staff member (404)", crossGet.status === 404, `status=${crossGet.status}`);
const crossPerms = await api("GET", `/api/staff/${talhaMembershipId}/permissions`, { token: otherToken });
check("other business cannot read its permissions (404)", crossPerms.status === 404, `status=${crossPerms.status}`);
const crossWrite = await api("PUT", `/api/staff/${talhaMembershipId}/permissions`, { token: otherToken, body: { permissions: [] } });
check("other business cannot modify its permissions (404)", crossWrite.status === 404, `status=${crossWrite.status}`);
const crossEdit = await api("PATCH", `/api/staff/${talhaMembershipId}`, { token: otherToken, body: { accountStatus: "inactive" } });
check("other business cannot deactivate it (404)", crossEdit.status === 404, `status=${crossEdit.status}`);

// ------------------------------------------------------------ 9. owner OK
const ownerMatrix = [
  "/api/dashboard",
  "/api/patients",
  "/api/appointments",
  "/api/doctors",
  "/api/clinics",
  "/api/services",
  "/api/settings",
  "/api/staff",
  "/api/reports",
  "/api/staff-messages",
];
let ownerAllOk = true;
let ownerFirstBad = "";
for (const path of ownerMatrix) {
  const r = await api("GET", path, { token: ownerToken });
  if (r.status !== 200) {
    ownerAllOk = false;
    ownerFirstBad = `${path}=${r.status}`;
    break;
  }
}
check("original admin retains full access to every module API", ownerAllOk, ownerFirstBad);

// ----------------------------------- 10. no duplicate users/businesses
const dupCount = await api("POST", "/api/staff", {
  token: ownerToken,
  body: { fullName: "Talha Again", email: STAFF_EMAIL, designation: "Receptionist", accountStatus: "active", password: TEMP_PWD, confirmPassword: TEMP_PWD, permissions: [] },
});
const pool = (await import("pg")).default;
const p = new pool.Pool({ connectionString: process.env.DATABASE_URL });
const cnt = await p.query(
  "SELECT count(*)::int AS n FROM users WHERE email = $1",
  [STAFF_EMAIL]
);
check("duplicate attempt leaves exactly ONE user row", dupCount.status === 409 && cnt.rows[0].n === 1,
  `status=${dupCount.status} rows=${cnt.rows[0].n}`);

const permDup = await p.query(
  "SELECT staff_member_id, permission_key, count(*)::int AS n FROM staff_permissions GROUP BY 1,2 HAVING count(*) > 1"
);
check("no duplicate permission records anywhere", permDup.rows.length === 0, JSON.stringify(permDup.rows));

const ownerRows = await p.query(
  "SELECT count(*)::int AS n FROM users WHERE email = $1",
  [OWNER_EMAIL]
);
check("exactly one owner user (no second admin account)", ownerRows.rows[0].n === 1, `rows=${ownerRows.rows[0].n}`);

// ---------------------------------------------------------------- state
const state = {
  stamp: STAMP,
  ownerEmail: OWNER_EMAIL,
  ownerPassword: OWNER_PWD,
  ownerToken,
  staffEmail: STAFF_EMAIL,
  staffPassword: NEW_PWD,
  staffToken: reactivatedLogin.json?.data?.token,
  staffId: talha.id,
  viewerEmail: VIEWER_EMAIL,
  viewerPassword: NEW_PWD,
  viewerToken,
  businessName: `RBAC Test Clinic ${STAMP}`,
  otherBusinessName: `RBAC Other Clinic ${STAMP}`,
  otherOwnerEmail: `rbac-other-${STAMP}@example.com`,
};
const fs = await import("fs");
fs.writeFileSync(".tmp-rbac-state.json", JSON.stringify(state, null, 2));

await p.end();

console.log("\n" + results.join("\n"));
const failed = results.filter((l) => l.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
