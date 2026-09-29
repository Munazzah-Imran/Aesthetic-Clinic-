/**
 * Live test for GET /api/dashboard:
 *  1. New business -> all counts 0, all lists empty (clean empty states).
 *  2. After adding doctor + patient + 3 appointments (today, +1d, +2d):
 *     counts become 1/1/3, recentPatients/doctors populate, today's
 *     appointment lands in todayAppointments and the two later ones land in
 *     upcomingAppointments in date order with full display info.
 *  3. Business isolation: a second business still sees all zeros.
 *  4. Cleanup: throwaway businesses removed, sequences restored.
 *
 * Run with:  node .tmp-dashboard-test.mjs   (server must run on :3010)
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const pool = new pg.Pool({
  connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
});

const B = "http://localhost:3010/api";
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const today = iso(now);
/** ID date stamp has NO dashes: PT-20260923-... (used in LIKE patterns). */
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const plusDays = (n) => iso(new Date(now.getTime() + n * 24 * 60 * 60 * 1000));
const tomorrow = plusDays(1);
const dayAfter = plusDays(2);

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

let tokenA = null;
let tokenB = null;
const businessIds = [];

const api = async (path, opts = {}, tok = tokenA) => {
  const res = await fetch(B + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
};

const signup = async (label) => {
  const email = `dash-test-${label}-${Date.now()}@example.com`;
  const r = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: `Dashboard Test ${label}`,
      name: "Dash Test",
      email,
      password: "secret123",
    }),
  });
  const id = r.json?.data?.business?.id ?? null;
  if (id) businessIds.push(id);
  const l = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "secret123" }),
  });
  return { businessId: id, token: l.json?.data?.token ?? null, ok: r.status === 201 && !!l.json?.data?.token };
};

const seqNext = async (name) => {
  const r = await pool.query(
    `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next FROM ${name}`
  );
  return Number(r.rows[0].next);
};

let prePtNext = null;
let preAptNext = null;

try {
  prePtNext = await seqNext("patient_id_sequence");
  preAptNext = await seqNext("appointment_id_sequence");
  console.log(`PRE : patient seq next=${prePtNext}, appointment seq next=${preAptNext}`);

  // ---- 1) Fresh business -> clean empty dashboard ----
  const a = await signup("A");
  tokenA = a.token;
  check("T1  business A signup+login", a.ok, `businessId=${a.businessId}`);

  let r = await api("/dashboard");
  let d = r.json?.data ?? {};
  check("T2  dashboard 200 for business A", r.status === 200 && r.json?.success, `status=${r.status}`);
  check(
    "T3  fresh business shows 0/0/0 with safe pendingReports",
    d.totalPatients === 0 && d.totalDoctors === 0 && d.totalAppointments === 0 && d.pendingReports === 0,
    JSON.stringify({ p: d.totalPatients, d: d.totalDoctors, a: d.totalAppointments, r: d.pendingReports })
  );
  check(
    "T4  all lists empty (clean empty states, no fake data)",
    Array.isArray(d.recentPatients) && d.recentPatients.length === 0 &&
      Array.isArray(d.doctors) && d.doctors.length === 0 &&
      Array.isArray(d.todayAppointments) && d.todayAppointments.length === 0 &&
      Array.isArray(d.upcomingAppointments) && d.upcomingAppointments.length === 0
  );
  check("T5  server-provided `today` is dynamic (today's date)", d.today === today, `today=${d.today}`);

  // ---- 2) Add real records ----
  let x = await api("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "Dashboard Test Clinic",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Dashboard test address 1",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "09:00",
      closingTime: "18:00",
    }),
  });
  const clinicId = x.json?.data?.id ?? null;
  check("T6  clinic created", x.status === 201 && !!clinicId, `status=${x.status}`);

  x = await api("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Dashboard Test" }) });
  const doctorId = x.json?.data?.id ?? null;
  check("T7  doctor created", x.status === 201 && !!doctorId, `status=${x.status}`);

  x = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Dashboard Test Patient",
      gender: "Female",
      dateOfBirth: "1992-04-04",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
    }),
  });
  const patientId = x.json?.data?.id ?? null;
  const patientCode = x.json?.data?.patient_id ?? "";
  check("T8  patient created", x.status === 201 && !!patientId, `status=${x.status} id=${patientCode}`);

  const mkApt = (date, time) =>
    api("/appointments", {
      method: "POST",
      body: JSON.stringify({
        patientId,
        doctorId,
        clinicId,
        appointmentDate: date,
        appointmentTime: time,
        appointmentType: "consultation",
      }),
    });

  const aptToday = await mkApt(today, "10:30");
  const aptTomorrow = await mkApt(tomorrow, "09:00");
  const aptDayAfter = await mkApt(dayAfter, "14:00");
  check(
    "T9  3 appointments created (today, +1d, +2d)",
    aptToday.status === 201 && aptTomorrow.status === 201 && aptDayAfter.status === 201,
    `${aptToday.status}/${aptTomorrow.status}/${aptDayAfter.status} ${aptToday.json?.message ?? ""}`
  );

  // ---- 3) Dashboard now reflects the real data ----
  r = await api("/dashboard");
  d = r.json?.data ?? {};
  check(
    "T10 counts are real: 1 patient / 1 doctor / 3 appointments",
    d.totalPatients === 1 && d.totalDoctors === 1 && d.totalAppointments === 3,
    JSON.stringify({ p: d.totalPatients, d: d.totalDoctors, a: d.totalAppointments })
  );
  check(
    "T11 recentPatients has the newest patient (name + ID + createdAt)",
    d.recentPatients?.length === 1 &&
      d.recentPatients[0]?.fullName === "Dashboard Test Patient" &&
      d.recentPatients[0]?.patientId === patientCode &&
      !!d.recentPatients[0]?.createdAt,
    JSON.stringify(d.recentPatients?.[0] ?? null)
  );
  check(
    "T12 doctors overview has the real doctor",
    d.doctors?.length === 1 && d.doctors[0]?.fullName === "Dr Dashboard Test",
    JSON.stringify(d.doctors?.[0] ?? null)
  );

  const ta = d.todayAppointments ?? [];
  const ua = d.upcomingAppointments ?? [];
  check(
    "T13 TODAY section holds exactly today's appointment (date = dynamic today)",
    ta.length === 1 && ta[0]?.appointmentDate === today,
    JSON.stringify(ta[0] ?? null)
  );
  const need = ["appointmentId", "patientName", "doctorName", "clinicName", "appointmentDate", "appointmentTime", "status"];
  const allSet = ta[0] && need.every((k) => typeof ta[0][k] === "string" && ta[0][k].length > 0);
  check(
    "T14 appointment shows ID, patient, doctor, clinic, date, time, status (no undefined/null/NaN)",
    !!allSet && !need.some((k) => /undefined|null|NaN/.test(String(ta[0]?.[k]))),
    JSON.stringify(ta[0] ?? null)
  );
  check(
    "T15 time formatted source intact (HH:MM from DB)",
    ta[0]?.appointmentTime === "10:30" && ta[0]?.appointmentId?.startsWith("APT-"),
    `${ta[0]?.appointmentId} ${ta[0]?.appointmentTime}`
  );
  check(
    "T16 UPCOMING sorted by date, no past/today mixed in",
    ua.length === 2 &&
      ua[0]?.appointmentDate === tomorrow &&
      ua[1]?.appointmentDate === dayAfter &&
      ua.every((x2) => (x2.appointmentDate ?? "") > today),
    ua.map((x2) => `${x2.appointmentDate} ${x2.appointmentTime}`).join(" | ")
  );

  // ---- 4) Business isolation ----
  const b = await signup("B");
  tokenB = b.token;
  check("T17 business B signup+login", b.ok, `businessId=${b.businessId}`);
  r = await api("/dashboard", {}, tokenB);
  d = r.json?.data ?? {};
  check(
    "T18 isolation: business B sees 0/0/0 despite A's records",
    d.totalPatients === 0 && d.totalDoctors === 0 && d.totalAppointments === 0 &&
      (d.recentPatients ?? []).length === 0 && (d.doctors ?? []).length === 0 &&
      (d.todayAppointments ?? []).length === 0 && (d.upcomingAppointments ?? []).length === 0,
    JSON.stringify({ p: d.totalPatients, d: d.totalDoctors, a: d.totalAppointments })
  );

  // ---- 5) Unauthenticated -> 401, no data leak ----
  r = await api("/dashboard", {}, "");
  check("T19 no token -> 401", r.status === 401, `status=${r.status}`);
} finally {
  try {
    for (const id of businessIds) {
      await pool.query("DELETE FROM appointment WHERE business_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM patient WHERE business_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM doctor WHERE business_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM clinic WHERE business_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM users WHERE business_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM business WHERE id = $1", [id]).catch(() => {});
    }

    // Forward-only sequence safety (NEVER rewinds — a rewind below existing
    // rows would make new inserts collide with the UNIQUE (business_id, id)
    // constraint). Matches the app bootstrap's GREATEST() rule.
    const restore = async (name, start, table, col, prefix, preNext) => {
      const max = await pool.query(
        `SELECT MAX(NULLIF(regexp_replace(${col}, '^.*-', ''), '')::int) AS m
           FROM ${table} WHERE ${col} LIKE $1`,
        [`${prefix}-${stamp}-%`]
      );
      const m = max.rows[0].m == null ? 0 : Number(max.rows[0].m);
      const seqNow = await seqNext(name);
      const target = Math.max(start, seqNow, m + 1);
      if (target > seqNow) {
        await pool.query("SELECT setval($1::regclass, $2, true)", [name, target - 1]);
      }
      const next = await seqNext(name);
      check(
        `T20 ${name} safe: strictly beyond every existing ID (pre=${preNext}, burned values may leave a gap)`,
        next >= start && next >= m + 1,
        `next=${next}, maxExistingSuffix=${m}`
      );
    };
    if (prePtNext !== null) await restore("patient_id_sequence", 1, "patient", "patient_id", "PT", prePtNext);
    if (preAptNext !== null) await restore("appointment_id_sequence", 5001, "appointment", "appointment_id", "APT", preAptNext);

    const leftovers = await pool.query(
      "SELECT (SELECT count(*)::int FROM business WHERE business_name LIKE 'Dashboard Test%') AS b, (SELECT count(*)::int FROM patient WHERE full_name LIKE 'Dashboard Test%') AS p, (SELECT count(*)::int FROM appointment a JOIN business b2 ON b2.id = a.business_id WHERE b2.business_name LIKE 'Dashboard Test%') AS a"
    );
    check(
      "T21 no leftover test data",
      leftovers.rows[0].b === 0 && leftovers.rows[0].p === 0 && leftovers.rows[0].a === 0,
      JSON.stringify(leftovers.rows[0])
    );
  } catch (err) {
    console.error("cleanup failed:", err);
  }
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
console.log("\nALL TESTS PASSED");
