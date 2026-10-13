/** Staff permission-removal + Delete Staff API checks. Run: node .tmp-staff-delete-api-test.mjs */
import fs from "fs";
import { Pool } from "pg";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const results = [];
const check = (n, c, e = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
const stamp = Date.now();

const H = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const call = async (method, path, token, body) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (e.g. dev error page) */ }
  return { status: res.status, json };
};
const noPermBody = (extra) => ({
  fullName: "Perm Option Test",
  email: `permopt-${stamp}@example.com`,
  phone: "0300-0000000",
  designation: "Nurse",
  accountStatus: "active",
  password: state.staffPassword,
  confirmPassword: state.staffPassword,
  ...extra,
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? fs.readFileSync(".env", "utf8").match(/DATABASE_URL=(.*)/)[1].trim(), max: 2 });

try {
  const owner = state.ownerToken;

  // ---------- 1. Removed permission options are rejected server-side ----------
  let r = await call("POST", "/api/staff", owner, noPermBody({ permissions: ["appointments", "staff_inbox"] }));
  const postPermMsg = r.json?.data?.errors?.permissions ?? r.json?.message ?? "";
  check("POST rejects payload containing Staff Inbox", r.status === 400 && postPermMsg.includes("no longer available"), `status=${r.status} msg=${postPermMsg}`);

  r = await call("POST", "/api/staff", owner, noPermBody({ permissions: ["reports"] }));
  const postPermMsg2 = r.json?.data?.errors?.permissions ?? r.json?.message ?? "";
  check("POST rejects Uploaded Reports / Images", r.status === 400 && postPermMsg2.includes("no longer available"), `status=${r.status} msg=${postPermMsg2}`);

  r = await call("POST", "/api/staff", owner, noPermBody({ permissions: ["emergency_alerts", "human_handover", "system_health", "audit_logs", "virtual_consultation", "staff"] }));
  check("POST rejects all six other removed options together", r.status === 400, `status=${r.status}`);

  r = await call("POST", "/api/staff", owner, noPermBody({ permissions: ["not_a_real_key"] }));
  check("POST still rejects unknown keys", r.status === 400, `status=${r.status}`);

  // ---------- 2. Remaining options (incl. Reminders) still work ----------
  const okEmail = `permok-${stamp}@example.com`;
  r = await call("POST", "/api/staff", owner, { ...noPermBody({ permissions: ["reminders", "appointments", "settings"] }), email: okEmail });
  check("POST accepts Reminders + other assignable options", r.status === 201, `status=${r.status} msg=${r.json?.message}`);
  const okMember = r.json?.data;
  check("created member has exactly the assigned keys", JSON.stringify([...(okMember?.permissions ?? [])].sort()) === JSON.stringify(["appointments", "reminders", "settings"]), JSON.stringify(okMember?.permissions));

  // ---------- 3. PATCH / PUT reject removed options too ----------
  r = await call("PUT", `/api/staff/${okMember?.id}/permissions`, owner, { permissions: ["audit_logs"] });
  check("PUT permissions rejects Audit Logs", r.status === 400, `status=${r.status} msg=${r.json?.message}`);

  r = await call("PUT", `/api/staff/${okMember?.id}/permissions`, owner, { permissions: ["system_health", "staff_inbox"] });
  check("PUT permissions rejects System Health + Staff Inbox", r.status === 400, `status=${r.status}`);

  r = await call("PATCH", `/api/staff/${okMember?.id}`, owner, { permissions: ["virtual_consultation"] });
  check("PATCH rejects Virtual Consultation", r.status === 400, `status=${r.status}`);

  r = await call("PUT", `/api/staff/${okMember?.id}/permissions`, owner, { permissions: ["reminders", "patients"] });
  check("PUT permissions accepts assignable keys", r.status === 200, `status=${r.status}`);

  // ---------- 4. DELETE guard rails ----------
  r = await call("DELETE", "/api/staff/not-a-uuid", owner);
  check("DELETE rejects malformed id", r.status === 400, `status=${r.status}`);

  r = await call("DELETE", "/api/staff/00000000-0000-0000-0000-000000000000", owner);
  check("DELETE unknown id -> 404", r.status === 404, `status=${r.status}`);

  // Cross-business probe is 404 by construction (membership scoped by business_id).

  // ---------- 5. Non-admin staff cannot delete ----------
  r = await call("POST", "/api/staff", owner, {
    fullName: "Delete Target",
    email: `deltarget-${stamp}@example.com`,
    phone: "0300-1111111",
    designation: "Receptionist",
    accountStatus: "active",
    password: state.staffPassword,
    confirmPassword: state.staffPassword,
    permissions: ["appointments"],
  });
  check("create delete-target member", r.status === 201, `status=${r.status}`);
  const target = r.json?.data;

  r = await call("DELETE", `/api/staff/${target?.id}`, state.staffToken);
  check("non-admin staff DELETE -> 403", r.status === 403, `status=${r.status} msg=${r.json?.message}`);

  // ---------- 6. Self-delete refused ----------
  await pool.query("UPDATE staff_members SET role = 'admin', must_change_password = FALSE WHERE id = $1", [target.id]);
  const login = await call("POST", "/api/auth/login", null, { email: target.email, password: state.staffPassword });
  const targetToken = login.json?.data?.token ?? login.json?.token;
  check("target (role=admin) can log in for guard test", Boolean(targetToken), `status=${login.status}`);
  if (targetToken) {
    const me = await call("GET", "/api/auth/me", targetToken);
    check("target token valid before delete", me.status === 200, `status=${me.status}`);
    r = await call("DELETE", `/api/staff/${target.id}`, targetToken);
    check("self-delete refused (400)", r.status === 400 && (r.json?.message ?? "").toLowerCase().includes("your own"), `status=${r.status} msg=${r.json?.message}`);
  }

  // ---------- 7. Business owner can never be deleted ----------
  const ownerRow = (await pool.query("SELECT id, business_id FROM users WHERE email = $1", [state.ownerEmail])).rows[0];
  await pool.query(
    `INSERT INTO staff_members (staff_id, user_id, business_id, designation, role, account_status, must_change_password)
     VALUES ($1, $2, $3, 'Owner Guard Test', 'staff', 'active', FALSE)
     ON CONFLICT DO NOTHING`,
    [`STF-OWN-GUARD-${stamp}`, ownerRow.id, ownerRow.business_id]
  );
  const ownerMembership = (await pool.query("SELECT id FROM staff_members WHERE user_id = $1 AND role = 'staff'", [ownerRow.id])).rows[0];
  if (targetToken) {
    r = await call("DELETE", `/api/staff/${ownerMembership.id}`, targetToken);
    check("owner membership delete refused (403)", r.status === 403 && (r.json?.message ?? "").includes("owner"), `status=${r.status} msg=${r.json?.message}`);
  }
  r = await call("DELETE", `/api/staff/${ownerMembership.id}`, owner);
  check("owner deleting own membership also refused (self guard)", r.status === 400, `status=${r.status} msg=${r.json?.message}`);

  // ---------- 8. The real delete: revocation + preservation ----------
  await pool.query("UPDATE staff_members SET role = 'staff' WHERE id = $1", [target.id]);
  // Seed a patient row so "historical patient records are preserved" is a
  // real assertion (not just 0 -> 0). Cleaned up at the end of the run.
  await pool.query(
    `INSERT INTO patient (business_id, patient_id, full_name, gender)
     VALUES ($1, $2, 'Preservation Probe', 'Female') ON CONFLICT DO NOTHING`,
    [ownerRow.business_id, `PT-PRESERVE-${stamp}`]
  );
  const counts = async () => ({
    appointments: (await pool.query(`SELECT COUNT(*)::int AS n FROM appointment WHERE business_id = $1`, [ownerRow.business_id])).rows[0].n,
    patients: (await pool.query(`SELECT COUNT(*)::int AS n FROM patient WHERE business_id = $1`, [ownerRow.business_id])).rows[0].n,
    probePatient: (await pool.query(`SELECT COUNT(*)::int AS n FROM patient WHERE business_id = $1 AND patient_id = $2`, [ownerRow.business_id, `PT-PRESERVE-${stamp}`])).rows[0].n,
    messages: (await pool.query(`SELECT COUNT(*)::int AS n FROM staff_messages WHERE business_id = $1`, [ownerRow.business_id])).rows[0].n,
    users: (await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE business_id = $1`, [ownerRow.business_id])).rows[0].n,
    permRows: (await pool.query(`SELECT COUNT(*)::int AS n FROM staff_permissions WHERE staff_member_id = $1`, [target.id])).rows[0].n,
  });
  const before = await counts();
  check("target starts with 1 permission row", before.permRows === 1, JSON.stringify(before));

  const meBefore = await call("GET", "/api/auth/me", targetToken);
  check("target can access APIs before delete", meBefore.status === 200, `status=${meBefore.status}`);

  r = await call("DELETE", `/api/staff/${target.id}`, owner);
  check("owner DELETE succeeds", r.status === 200 && r.json?.success, `status=${r.status} msg=${r.json?.message}`);

  const meAfter = await call("GET", "/api/auth/me", targetToken);
  check("existing token revoked immediately (401)", meAfter.status === 401, `status=${meAfter.status}`);

  const loginAfter = await call("POST", "/api/auth/login", null, { email: target.email, password: state.staffPassword });
  check("login refused after delete", loginAfter.status !== 200 && loginAfter.status !== 201, `status=${loginAfter.status} msg=${loginAfter.json?.message}`);

  const list = await call("GET", "/api/staff", owner);
  const listed = (list.json?.data ?? []).map((m) => m.id);
  check("removed from Staff Management list", !listed.includes(target.id), `listed=${listed.length}`);

  const getOne = await call("GET", `/api/staff/${target.id}`, owner);
  check("GET by id -> 404 after delete", getOne.status === 404, `status=${getOne.status}`);

  const patch = await call("PATCH", `/api/staff/${target.id}`, owner, { accountStatus: "active" });
  check("deleted member cannot be edited/reactivated (404)", patch.status === 404, `status=${patch.status}`);

  const after = await counts();
  check(
    "appointments / patients / messages / users counts unchanged",
    after.appointments === before.appointments && after.patients === before.patients && after.messages === before.messages && after.users === before.users,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
  );
  check("seeded patient record survives the delete", before.probePatient === 1 && after.probePatient === 1, `before=${before.probePatient} after=${after.probePatient}`);
  const soft = (await pool.query("SELECT account_status, deleted_at, role FROM staff_members WHERE id = $1", [target.id])).rows[0];
  check(
    "membership soft-deleted + deactivated (row preserved)",
    Boolean(soft?.deleted_at) && soft?.account_status === "inactive" && soft?.role === "staff",
    JSON.stringify(soft)
  );
  check("permission assignments removed", after.permRows === 0, `permRows=${after.permRows}`);
  const userRow = (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email = $1", [target.email])).rows[0];
  check("users row (login identity/history) preserved", userRow.n === 1, `n=${userRow.n}`);

  // ---------- 9. Cleanup: fake owner membership + leftover test rows ----------
  await pool.query("DELETE FROM staff_members WHERE id = $1", [ownerMembership.id]);
  await pool.query(`DELETE FROM patient WHERE business_id = $1 AND patient_id = $2`, [ownerRow.business_id, `PT-PRESERVE-${stamp}`]);
  check("owner guard membership + probe patient cleaned up", true);

  const leftoverRows = (await pool.query(
    `SELECT sm.id FROM staff_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.business_id = $1 AND sm.deleted_at IS NULL
        AND (u.email LIKE 'twostep-%@example.com' OR u.email LIKE 'permok-%@example.com')`,
    [ownerRow.business_id]
  )).rows;
  let cleaned = 0;
  for (const row of leftoverRows) {
    const del = await call("DELETE", `/api/staff/${row.id}`, owner);
    if (del.status === 200) cleaned++;
  }
  check(`leftover test staff cleaned via DELETE API (${leftoverRows.length} found)`, cleaned === leftoverRows.length, `cleaned=${cleaned}/${leftoverRows.length}`);
} catch (err) {
  results.push(`ERROR ${err?.message ?? err}`);
} finally {
  console.log(results.join("\n"));
  await pool.end();
  const failed = results.some((line) => line.startsWith("FAIL") || line.startsWith("ERROR"));
  process.exit(failed ? 1 : 0);
}
