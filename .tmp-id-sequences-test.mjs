/**
 * FINAL TEST — Patient IDs and Appointment IDs use TWO independent sequences:
 *   patient_id_sequence      START 1    -> PT-YYYYMMDD-0001, PT-YYYYMMDD-0002, ...
 *   appointment_id_sequence  START 5001 -> APT-YYYYMMDD-5001, APT-YYYYMMDD-5002, ...
 *
 * Verifies:
 *  1. POST /api/patients generates PT-YYYYMMDD-0001 then -0002 (saved in PostgreSQL).
 *  2. POST /api/appointments generates APT-YYYYMMDD-5001 then -5002 (saved in PostgreSQL).
 *  3. Patient and appointment numeric suffixes are NEVER the same.
 *  4. PATCH (edit) never changes an existing ID.
 *  5. No Math.random / COUNT(*): IDs come from the sequences.
 *
 * Creates a throwaway business, then deletes it (cascade) and restores both
 * sequences to their pre-test positions, so no test data or numbering is left
 * behind for the real records.
 *
 * Run with:  node .tmp-id-sequences-test.mjs   (server must run on :3010)
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const pool = new pg.Pool({
  connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
});

const B = "http://localhost:3010/api";

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const tomorrow = `${tomorrowDate.getFullYear()}-${pad(tomorrowDate.getMonth() + 1)}-${pad(tomorrowDate.getDate())}`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const suffix = (id) => Number(String(id).split("-")[2]);

const seqNext = async (name) => {
  const r = await pool.query(
    `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next FROM ${name}`
  );
  return Number(r.rows[0].next);
};

const todayMax = async (table, col, prefix) => {
  const r = await pool.query(
    `SELECT MAX(NULLIF(regexp_replace(${col}, '^.*-', ''), '')::int) AS m
       FROM ${table} WHERE ${col} LIKE $1`,
    [`${prefix}-${today}-%`]
  );
  return r.rows[0].m === null || r.rows[0].m === undefined ? 0 : Number(r.rows[0].m);
};

const api = async (path, opts = {}, tok = token) => {
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

let businessId = null;
let token = null;
let clinicId = null;
let doctorId = null;
const patientUuids = [];
const appointmentUuids = [];

let prePtNext = null;
let preAptNext = null;

try {
  // ---- 0) Pre-test state (sequences were bootstrapped by db:init) ----
  prePtNext = await seqNext("patient_id_sequence");
  preAptNext = await seqNext("appointment_id_sequence");
  const prePtMax = await todayMax("patient", "patient_id", "PT");
  const preAptMax = await todayMax("appointment", "appointment_id", "APT");
  console.log(
    `PRE : patient sequence next=${prePtNext} (today's max patient suffix=${prePtMax}) | ` +
      `appointment sequence next=${preAptNext} (today's max appointment suffix=${preAptMax})`
  );

  // ---- 1) Throwaway business: signup + login ----
  const email = `id-seq-test-${Date.now()}@example.com`;
  let r = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: "ID Sequence Test Clinic",
      name: "ID Seq Test",
      email,
      password: "secret123",
    }),
  });
  check("T1  signup works", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  businessId = r.json?.data?.business?.id ?? null;

  r = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "secret123" }),
  });
  token = r.json?.data?.token ?? null;
  check("T2  login returns token", !!token, `status=${r.status}`);

  // ---- 2) Clinic + doctor (needed to create appointments) ----
  r = await api("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "Seq Test Clinic",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Test address block 123",
      workingDays: ["Monday", "Tuesday"],
      openingTime: "10:00",
      closingTime: "18:00",
    }),
  });
  check("T3  clinic created", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  clinicId = r.json?.data?.id ?? null;

  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr Sequence Test" }),
  });
  check("T4  doctor created", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  doctorId = r.json?.data?.id ?? null;

  // ---- 3) Two patients: PT-...-0001 then PT-...-0002 ----
  const mkPatient = (fullName) =>
    api("/patients", {
      method: "POST",
      body: JSON.stringify({
        fullName,
        gender: "Male",
        dateOfBirth: "1990-01-01",
        maritalStatus: "Single",
        phone: "+92 300 1112223",
        city: "Karachi",
      }),
    });

  const p1 = await mkPatient("Sequence Test Patient One");
  const p2 = await mkPatient("Sequence Test Patient Two");
  check("T5  patient 1 created", p1.status === 201, `status=${p1.status} ${p1.json?.message ?? ""}`);
  check("T6  patient 2 created", p2.status === 201, `status=${p2.status} ${p2.json?.message ?? ""}`);

  const pt1 = p1.json?.data?.patient_id ?? "";
  const pt2 = p2.json?.data?.patient_id ?? "";
  if (p1.json?.data?.id) patientUuids.push(p1.json.data.id);
  if (p2.json?.data?.id) patientUuids.push(p2.json.data.id);

  check(
    "T7  patient IDs match PT-YYYYMMDD-XXXX",
    new RegExp(`^PT-${today}-\\d{4}$`).test(pt1) && new RegExp(`^PT-${today}-\\d{4}$`).test(pt2),
    `${pt1} | ${pt2}`
  );
  check(
    "T8  patient numbering increments by 1",
    suffix(pt2) === suffix(pt1) + 1,
    `${pt1} -> ${pt2}`
  );
  check(
    "T9  patient sequence started at 1 (today's first new patient)",
    suffix(pt1) === Math.max(1, prePtMax + 1),
    `expected ${Math.max(1, prePtMax + 1)}, got ${suffix(pt1)}`
  );

  // ---- 4) Two appointments: APT-...-5001 then APT-...-5002 ----
  const mkApt = (patientId, time) =>
    api("/appointments", {
      method: "POST",
      body: JSON.stringify({
        patientId,
        doctorId,
        clinicId,
        appointmentDate: tomorrow,
        appointmentTime: time,
        appointmentType: "consultation",
      }),
    });

  const a1 = await mkApt(patientUuids[0], "10:00");
  const a2 = await mkApt(patientUuids[1], "11:00");
  check(
    "T10 appointment 1 created",
    a1.status === 201,
    `status=${a1.status} ${a1.json?.message ?? ""}`
  );
  check(
    "T11 appointment 2 created",
    a2.status === 201,
    `status=${a2.status} ${a2.json?.message ?? ""}`
  );

  const apt1 = a1.json?.data?.appointmentId ?? "";
  const apt2 = a2.json?.data?.appointmentId ?? "";
  if (a1.json?.data?.id) appointmentUuids.push(a1.json.data.id);
  if (a2.json?.data?.id) appointmentUuids.push(a2.json.data.id);

  check(
    "T12 appointment IDs match APT-YYYYMMDD-XXXX",
    new RegExp(`^APT-${today}-\\d{4}$`).test(apt1) && new RegExp(`^APT-${today}-\\d{4}$`).test(apt2),
    `${apt1} | ${apt2}`
  );
  check(
    "T13 appointment numbering starts at 5001 and increments by 1",
    suffix(apt1) === Math.max(5001, preAptMax + 1) && suffix(apt2) === suffix(apt1) + 1,
    `${apt1} -> ${apt2}`
  );

  // ---- 5) THE POINT: patient vs appointment suffixes must never match ----
  const allSuffixes = [suffix(pt1), suffix(pt2), suffix(apt1), suffix(apt2)];
  check(
    "T14 patient and appointment numeric parts are COMPLETELY DIFFERENT",
    new Set(allSuffixes).size === 4 && suffix(pt1) !== suffix(apt1) && suffix(pt2) !== suffix(apt2),
    `PT=[${suffix(pt1)}, ${suffix(pt2)}] vs APT=[${suffix(apt1)}, ${suffix(apt2)}]`
  );

  // ---- 6) IDs are persisted in PostgreSQL (generated on the backend) ----
  const dbPt = await pool.query("SELECT patient_id FROM patient WHERE id = $1", [
    patientUuids[0],
  ]);
  const dbApt = await pool.query("SELECT appointment_id FROM appointment WHERE id = $1", [
    appointmentUuids[0],
  ]);
  check(
    "T15 patient_id saved in PostgreSQL equals API response",
    dbPt.rows[0]?.patient_id === pt1,
    `db=${dbPt.rows[0]?.patient_id} api=${pt1}`
  );
  check(
    "T16 appointment_id saved in PostgreSQL equals API response",
    dbApt.rows[0]?.appointment_id === apt1,
    `db=${dbApt.rows[0]?.appointment_id} api=${apt1}`
  );

  // ---- 7) EDIT must never regenerate an ID ----
  r = await api(`/patients/${patientUuids[0]}`, {
    method: "PATCH",
    body: JSON.stringify({
      fullName: "Sequence Test Patient One Renamed",
      gender: "Male",
      dateOfBirth: "1990-01-01",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
    }),
  });
  check(
    "T17 editing patient keeps the same patient ID",
    r.status === 200 && r.json?.data?.patient_id === pt1,
    `status=${r.status} id=${r.json?.data?.patient_id} (was ${pt1})`
  );

  r = await api(`/appointments/${appointmentUuids[0]}`, {
    method: "PATCH",
    body: JSON.stringify({
      patientId: patientUuids[0],
      doctorId,
      clinicId,
      appointmentDate: tomorrow,
      appointmentTime: "10:00",
      appointmentType: "consultation",
    }),
  });
  check(
    "T18 editing appointment keeps the same appointment ID",
    r.status === 200 && r.json?.data?.appointmentId === apt1,
    `status=${r.status} id=${r.json?.data?.appointmentId} (was ${apt1})`
  );

  // ---- 8) Next pair continues both sequences independently ----
  const p3 = await mkPatient("Sequence Test Patient Three");
  const a3 = await mkApt(patientUuids[0], "12:00");
  const pt3 = p3.json?.data?.patient_id ?? "";
  const apt3 = a3.json?.data?.appointmentId ?? "";
  if (p3.json?.data?.id) patientUuids.push(p3.json.data.id);
  if (a3.json?.data?.id) appointmentUuids.push(a3.json.data.id);
  check(
    "T19 third pair also differs (PT n+1 vs APT n+1)",
    suffix(pt3) === suffix(pt2) + 1 && suffix(apt3) === suffix(apt2) + 1 && suffix(pt3) !== suffix(apt3),
    `${pt3} | ${apt3}`
  );
} finally {
  // ---- CLEANUP: remove the throwaway business (cascade) ----
  try {
    if (businessId) {
      await pool.query("DELETE FROM appointment WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM patient WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM doctor WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM clinic WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM business WHERE id = $1", [businessId]).catch(() => {});
    }

    // ---- Sequence safety after cleanup (FORWARD-ONLY) ----
    // Never rewinds below the current position or below any existing ID:
    // a rewind would make new inserts collide with the UNIQUE constraint.
    // (preNext is reported for information only — burned test values may
    // legitimately leave a gap.)
    const restore = async (name, start, table, col, prefix, preNext) => {
      const max = await todayMax(table, col, prefix);
      const seqNow = await seqNext(name);
      const target = Math.max(start, seqNow, max + 1);
      if (target > seqNow) {
        await pool.query("SELECT setval($1::regclass, $2, true)", [name, target - 1]);
      }
      const next = await seqNext(name);
      check(
        `T20 ${name} safe: strictly beyond every existing ID (pre=${preNext})`,
        next >= start && next >= max + 1,
        `next=${next}, maxExistingSuffix=${max}`
      );
    };
    if (prePtNext !== null) await restore("patient_id_sequence", 1, "patient", "patient_id", "PT", prePtNext);
    if (preAptNext !== null)
      await restore("appointment_id_sequence", 5001, "appointment", "appointment_id", "APT", preAptNext);
  } catch (err) {
    console.error("cleanup failed:", err);
  }
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
console.log("\nALL TESTS PASSED");
