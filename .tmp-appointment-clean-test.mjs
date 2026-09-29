/**
 * Live test — Appointment module without reason/notes:
 *  1. POST /api/appointments WITHOUT reason/notes saves successfully.
 *  2. GET list / GET one / PATCH / GET dashboard all work and contain
 *     NO reason/notes keys, with every other field preserved.
 *  3. Schema: reason + notes columns gone, other columns untouched,
 *     the 2 pre-existing appointment records still present.
 *  4. Cleanup removes the throwaway business; ID sequences are restored
 *     to their exact pre-test positions (only when verified safe in one
 *     session: global max same-day suffix must be exactly pre - 1).
 *
 * Run with:  node .tmp-appointment-clean-test.mjs   (server on :3010)
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const pool = new pg.Pool({
  connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
});

const PORT = process.env.TEST_PORT || 3010;
const B = `http://localhost:${PORT}/api`;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
/** Dashed date for API payloads. */
const today = iso(now);
const tomorrow = iso(new Date(now.getTime() + 24 * 60 * 60 * 1000));
/** ID date stamp has NO dashes: PT-20260923-... (used in LIKE patterns). */
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const noReasonNotes = (obj) => {
  const s = JSON.stringify(obj);
  return !/"reason"|"notes"/.test(s);
};

const seqNext = async (name) => {
  const r = await pool.query(
    `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next FROM ${name}`
  );
  return Number(r.rows[0].next);
};

let token = null;
let businessId = null;
let appointmentUuid = null;
let prePtNext = null;
let preAptNext = null;

const api = async (path, opts = {}) => {
  const res = await fetch(B + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
};

try {
  prePtNext = await seqNext("patient_id_sequence");
  preAptNext = await seqNext("appointment_id_sequence");
  console.log(`PRE: patient next=${prePtNext}, appointment next=${preAptNext}`);

  // ---- fixture: business + clinic + doctor + patient ----
  const email = `appt-clean-${Date.now()}@example.com`;
  let r = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ businessName: "Appt Clean Test", name: "Appt Test", email, password: "secret123" }),
  });
  businessId = r.json?.data?.business?.id ?? null;
  check("T1  signup", r.status === 201 && !!businessId, `status=${r.status}`);
  r = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
  token = r.json?.data?.token ?? null;
  check("T2  login", !!token, `status=${r.status}`);

  r = await api("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "Appt Clean Clinic", city: "Karachi", cityCode: "KHI",
      contactNumber: "+92 300 1112223", fullClinicAddress: "Clean test address 1",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "09:00", closingTime: "18:00",
    }),
  });
  const clinicId = r.json?.data?.id ?? null;
  check("T3  clinic", r.status === 201 && !!clinicId, `status=${r.status}`);

  r = await api("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Appt Clean Test" }) });
  const doctorId = r.json?.data?.id ?? null;
  check("T4  doctor", r.status === 201 && !!doctorId, `status=${r.status}`);

  r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Appt Clean Patient", gender: "Male", dateOfBirth: "1991-01-01",
      maritalStatus: "Single", phone: "+92 300 1112223", city: "Karachi",
    }),
  });
  const patientId = r.json?.data?.id ?? null;
  check("T5  patient", r.status === 201 && !!patientId, `status=${r.status}`);

  // ---- 8) CREATE without reason/notes ----
  r = await api("/appointments", {
    method: "POST",
    body: JSON.stringify({
      patientId, doctorId, clinicId,
      appointmentDate: tomorrow,
      appointmentTime: "10:00",
      appointmentType: "consultation",
      status: "scheduled",
      // reason / notes intentionally ABSENT
    }),
  });
  appointmentUuid = r.json?.data?.id ?? null;
  const created = r.json?.data ?? {};
  check(
    "T6  CREATE works without reason/notes (201)",
    r.status === 201 && !!appointmentUuid,
    `status=${r.status} ${r.json?.message ?? ""}`
  );
  check(
    "T7  created payload has NO reason/notes keys",
    noReasonNotes(r.json),
    `appointmentId=${created.appointmentId ?? ""}`
  );
  check(
    "T8  all preserved fields returned (ID, patient, doctor, clinic, date, time, type, status)",
    typeof created.appointmentId === "string" && created.appointmentId.startsWith("APT-") &&
      created.patientId === patientId && created.doctorId === doctorId && created.clinicId === clinicId &&
      String(created.appointmentDate).slice(0, 10) === tomorrow &&
      created.appointmentTime === "10:00" && created.appointmentType === "consultation" &&
      created.status === "scheduled" && !!created.createdAt && !!created.businessId,
    JSON.stringify({ id: created.appointmentId, date: created.appointmentDate, time: created.appointmentTime })
  );

  // ---- 9) LIST ----
  r = await api("/appointments");
  const list = Array.isArray(r.json?.data) ? r.json.data : [];
  const row = list.find((x) => x.id === appointmentUuid);
  check(
    "T9  LIST works, no reason/notes in any row",
    r.status === 200 && list.length === 1 && noReasonNotes(list),
    `rows=${list.length}`
  );
  check(
    "T10 list row shows joins: patient/doctor/clinic names",
    !!row && typeof row.patient?.fullName === "string" && typeof row.doctor?.fullName === "string" &&
      typeof row.clinic?.clinicName === "string",
    JSON.stringify(row ? { p: row.patient?.fullName, d: row.doctor?.fullName, c: row.clinic?.clinicName } : null)
  );

  // ---- GET one ----
  r = await api(`/appointments/${appointmentUuid}`);
  check(
    "T11 GET one works, no reason/notes",
    r.status === 200 && noReasonNotes(r.json),
    `status=${r.status}`
  );

  // ---- PATCH (edit) without reason/notes ----
  r = await api(`/appointments/${appointmentUuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      patientId, doctorId, clinicId,
      appointmentDate: tomorrow,
      appointmentTime: "10:30",
      appointmentType: "follow_up",
      status: "confirmed",
    }),
  });
  check(
    "T12 PATCH works without reason/notes (200)",
    r.status === 200,
    `status=${r.status} ${r.json?.message ?? ""}`
  );
  check(
    "T13 PATCH response has no reason/notes and shows the update",
    noReasonNotes(r.json) && r.json?.data?.appointmentTime === "10:30" &&
      r.json?.data?.appointmentType === "follow_up" && r.json?.data?.status === "confirmed" &&
      r.json?.data?.appointmentId === created.appointmentId,
    JSON.stringify({ t: r.json?.data?.appointmentTime, id: r.json?.data?.appointmentId })
  );

  // ---- dashboard still fine ----
  r = await api("/dashboard");
  const d = r.json?.data ?? {};
  check(
    "T14 dashboard loads: count=1, appointment in upcoming, no reason/notes",
    r.status === 200 && d.totalAppointments === 1 &&
      (d.upcomingAppointments ?? []).some((x) => x.id === appointmentUuid) && noReasonNotes(d),
    JSON.stringify({ total: d.totalAppointments, upcoming: (d.upcomingAppointments ?? []).length })
  );
} finally {
  try {
    // ---- cleanup throwaway business (cascade) ----
    if (businessId) {
      await pool.query("DELETE FROM appointment WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM patient WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM doctor WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM clinic WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE business_id = $1", [businessId]).catch(() => {});
      await pool.query("DELETE FROM business WHERE id = $1", [businessId]).catch(() => {});
    }

    // ---- restore sequences ONLY when verified safe (single session) ----
    const restore = async (name, preNext, prefix, table, col) => {
      if (preNext === null) return;
      const mx = await pool.query(
        `SELECT MAX(NULLIF(regexp_replace(${col}, '^.*-', ''), '')::int) AS m
           FROM ${table} WHERE ${col} LIKE $1`,
        [`${prefix}-${stamp}-%`]
      );
      const m = mx.rows[0].m == null ? 0 : Number(mx.rows[0].m);
      const cur = await seqNext(name);
      if (preNext === m + 1 && cur > preNext) {
        // Safe (verified in ONE session): global same-day max is exactly
        // pre-1 (my test row is gone), so rewinding to pre re-links
        // perfectly with the real records.
        await pool.query("SELECT setval($1::regclass, $2, true)", [name, preNext - 1]);
      }
      const next = await seqNext(name);
      check(
        `T15 ${name} restored & safe`,
        next === preNext || next >= m + 1,
        `next=${next} (pre=${preNext}), maxExisting=${m}`
      );
    };
    await restore("patient_id_sequence", prePtNext, "PT", "patient", "patient_id");
    await restore("appointment_id_sequence", preAptNext, "APT", "appointment", "appointment_id");

    // ---- 7) schema + record verification ----
    const cols = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'appointment' ORDER BY ordinal_position"
    );
    const names = cols.rows.map((x) => x.column_name);
    check(
      "T16 reason + notes columns removed, all others intact",
      !names.includes("reason") && !names.includes("notes") &&
        ["id", "business_id", "appointment_id", "patient_id", "doctor_id", "clinic_id",
         "appointment_date", "appointment_time", "appointment_type", "status",
         "created_at", "updated_at"].every((c) => names.includes(c)),
      names.join(", ")
    );
    const cnt = await pool.query("SELECT count(*)::int AS c FROM appointment");
    const ids = await pool.query("SELECT appointment_id FROM appointment ORDER BY appointment_id");
    check(
      "T17 pre-existing appointment records intact",
      cnt.rows[0].c === 2 && ids.rows.map((x) => x.appointment_id).join(",") ===        "APT-20260923-5001,APT-20260923-5002",
      `count=${cnt.rows[0].c} ids=${ids.rows.map((x) => x.appointment_id).join(",")}`
    );
    const leftovers = await pool.query(
      "SELECT (SELECT count(*)::int FROM business WHERE business_name = 'Appt Clean Test') AS b, (SELECT count(*)::int FROM patient WHERE full_name = 'Appt Clean Patient') AS p"
    );
    check(
      "T18 no leftover test data",
      leftovers.rows[0].b === 0 && leftovers.rows[0].p === 0,
      JSON.stringify(leftovers.rows[0])
    );
  } catch (err) {
    console.error("cleanup/verification failed:", err);
  }
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
console.log("\nALL TESTS PASSED");
