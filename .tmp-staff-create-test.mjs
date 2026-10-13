/**
 * End-to-end staff creation test against the running dev server + real DB.
 * Covers the required verification points:
 *   - admin (owner) signup/login works
 *   - staff creation succeeds (the previously failing "Unable to create staff account")
 *   - name/email/role stored in users, password stored ONLY as bcrypt hash
 *   - permissions stored in staff_permissions keyed by user_id + business_id
 *   - staff login + forced password change flow works
 *   - duplicate email -> 409; non-admin cannot create staff
 *   - obsolete tables NOT recreated by ensureStaffTables at runtime
 */
import fs from "node:fs";
import { Pool } from "pg";

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
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const OWNER_EMAIL = `staff-e2e-owner-${STAMP}@example.com`;
const STAFF_EMAIL = `staff-e2e-member-${STAMP}@example.com`;
const OWNER_PWD = `OwnerE2E-${STAMP}-Pass`;
const TEMP_PWD = `TempE2E-${STAMP}-Pass`;
const NEW_PWD = `NewE2E-${STAMP}-Pass`;
const PERMS = ["overview", "appointments", "patients"];

// ---- 1. admin signup + login ----
const signup = await api("POST", "/api/auth/signup", {
  body: { businessName: `Staff E2E Clinic ${STAMP}`, name: "E2E Owner", email: OWNER_EMAIL, password: OWNER_PWD },
});
check("admin signup works", signup.status === 201 && signup.json?.success, `status=${signup.status}`);

const login = await api("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PWD } });
const ownerToken = login.json?.data?.token;
check("admin login returns token", Boolean(ownerToken), `status=${login.status}`);

// New signups start with must_change_password = TRUE (DB default): the app
// requires the forced change before any other API call. This is the existing
// auth flow — perform it exactly like the UI would.
const OWNER_PWD2 = `OwnerE2E2-${STAMP}-Pass`;
const ownerPwdChange = await api("PATCH", "/api/password", {
  token: ownerToken,
  body: { currentPassword: OWNER_PWD, newPassword: OWNER_PWD2, confirmPassword: OWNER_PWD2 },
});
check("owner completes forced first-login password change",
  ownerPwdChange.status >= 200 && ownerPwdChange.status < 300,
  `status=${ownerPwdChange.status} msg=${ownerPwdChange.json?.message ?? ""}`);

// ---- 2. staff creation (the previously failing path: non-empty permissions) ----
const create = await api("POST", "/api/staff", {
  token: ownerToken,
  body: {
    fullName: "E2E Test Member",
    email: STAFF_EMAIL,
    phone: "03001234567",
    designation: "Nurse",
    accountStatus: "active",
    password: TEMP_PWD,
    confirmPassword: TEMP_PWD,
    permissions: PERMS,
  },
});
check("staff creation succeeds (201)", create.status === 201 && create.json?.success,
  `status=${create.status} msg=${create.json?.message ?? ""} err=${JSON.stringify(create.json?.data ?? create.json?.error ?? "")}`);

const created = create.json?.data;
check("created record has UUID id + STF staffId + numeric userId",
  Boolean(created) && /^[0-9a-f-]{36}$/i.test(created?.id ?? "") &&
  /^STF-\d{8}-\d{4}$/.test(created?.staffId ?? "") && typeof created?.userId === "number",
  JSON.stringify({ id: created?.id, staffId: created?.staffId, userId: created?.userId }));
check("created record exposes no password/hash",
  Boolean(created) && !JSON.stringify(created).includes(TEMP_PWD) &&
  !JSON.stringify(created).includes("$2") &&
  !("password" in (created ?? {})) && !("passwordHash" in (created ?? {})));

// ---- 3. DB verification ----
const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });
const one = async (sql, p) => (await pool.query(sql, p)).rows[0];
const many = async (sql, p) => (await pool.query(sql, p)).rows;

const u = await one(`SELECT * FROM users WHERE email = $1`, [STAFF_EMAIL]);
check("users row exists with name/email", Boolean(u) && u.name === "E2E Test Member");
check("users.role = 'staff'", u?.role === "staff", `role=${u?.role}`);
check("users.business_id set (uuid)", Boolean(u?.business_id));
check("password stored ONLY as bcrypt hash",
  Boolean(u) && u.password !== TEMP_PWD && /^\$2[aby]\$\d{2}\$/.test(u.password),
  `prefix=${String(u?.password).slice(0, 4)}`);
check("users carries staff handles (staff_id + staff_uuid)",
  /^STF-\d{8}-\d{4}$/.test(u?.staff_id ?? "") && /^[0-9a-f-]{36}$/i.test(u?.staff_uuid ?? ""),
  `staff_id=${u?.staff_id}`);

const permRows = await many(
  `SELECT permission_key, business_id FROM staff_permissions WHERE user_id = $1 ORDER BY permission_key`,
  [u?.id]
);
check("permissions in staff_permissions keyed by user_id",
  permRows.length === PERMS.length &&
  permRows.every((r) => PERMS.includes(r.permission_key)) &&
  permRows.every((r) => r.business_id === u?.business_id),
  JSON.stringify(permRows.map((r) => r.permission_key)));

const spCols = await many(
  `SELECT column_name FROM information_schema.columns WHERE table_name='staff_permissions'`
);
check("staff_permissions has NO staff_member_id column",
  !spCols.some((c) => c.column_name === "staff_member_id"),
  spCols.map((c) => c.column_name).join(","));

// ---- 4. obsolete tables not recreated (ensureStaffTables ran during create) ----
const obs = await many(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
      ('staff_members','uploaded_report','virtual_consultation')`
);
check("obsolete tables NOT recreated at runtime", obs.length === 0,
  obs.length ? obs.map((o) => o.table_name).join(",") : "none");

// ---- 5. staff list for admin shows the new member ----
const list = await api("GET", "/api/staff", { token: ownerToken });
const listed = (list.json?.data ?? []).find((m) => m.email === STAFF_EMAIL);
check("admin staff list contains new member", list.status === 200 && Boolean(listed),
  `status=${list.status} n=${list.json?.data?.length}`);

// ---- 6. staff login + forced first-login password change ----
const staffLogin = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: TEMP_PWD } });
const staffToken = staffLogin.json?.data?.token;
check("staff login works with temp password", Boolean(staffToken), `status=${staffLogin.status}`);

const blocked = await api("GET", "/api/staff", { token: staffToken });
check("staff blocked before password change (403)", blocked.status === 403, `status=${blocked.status}`);

const pwdChange = await api("PATCH", "/api/password", {
  token: staffToken,
  body: { currentPassword: TEMP_PWD, newPassword: NEW_PWD, confirmPassword: NEW_PWD },
});
check("password change succeeds", pwdChange.status >= 200 && pwdChange.status < 300,
  `status=${pwdChange.status} msg=${pwdChange.json?.message ?? ""}`);

const staffLogin2 = await api("POST", "/api/auth/login", { body: { email: STAFF_EMAIL, password: NEW_PWD } });
check("staff login with new password", Boolean(staffLogin2.json?.data?.token), `status=${staffLogin2.status}`);

const mcp = await one(`SELECT must_change_password FROM users WHERE id = $1`, [u?.id]);
check("must_change_password cleared in users", mcp?.must_change_password === false);

// ---- 7. duplicate email -> 409 ----
const dup = await api("POST", "/api/staff", {
  token: ownerToken,
  body: {
    fullName: "Duplicate", email: STAFF_EMAIL, designation: "Nurse", accountStatus: "active",
    password: TEMP_PWD, confirmPassword: TEMP_PWD, permissions: [],
  },
});
check("duplicate email rejected with 409", dup.status === 409, `status=${dup.status}`);

// ---- 8. non-admin staff cannot create staff ----
const noPerm = await api("POST", "/api/staff", {
  token: staffLogin2.json?.data?.token,
  body: {
    fullName: "Nope", email: `nope-${STAMP}@example.com`, designation: "X", accountStatus: "active",
    password: TEMP_PWD, confirmPassword: TEMP_PWD, permissions: [],
  },
});
check("staff (non-admin) cannot create staff (403)", noPerm.status === 403, `status=${noPerm.status}`);

// ---- 9. admin dashboard endpoints still work ----
const me = await api("GET", "/api/auth/me", { token: ownerToken });
check("admin /api/auth/me works", me.status === 200, `status=${me.status}`);
const perms = await api("GET", "/api/auth/permissions", { token: ownerToken });
check("admin permissions endpoint works (19 keys, no removed keys)",
  perms.status === 200 && Array.isArray(perms.json?.data?.permissions) &&
  perms.json.data.permissions.length === 19 &&
  !perms.json.data.permissions.includes("reports") &&
  !perms.json.data.permissions.includes("virtual_consultation"),
  `n=${perms.json?.data?.permissions?.length}`);

await pool.end();

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
