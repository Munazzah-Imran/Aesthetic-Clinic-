/**
 * Seeds a throwaway business with real consultations (one per status) for
 * the Virtual Consultation UI test, writing credentials to .tmp-vc-ui.json.
 * Run: node .tmp-vc-seed.mjs        (server on :3010 or TEST_PORT)
 * Wipe afterwards: node .tmp-vc-seed.mjs cleanup
 */
import fs from "fs";

const PORT = process.env.TEST_PORT || "3010";
const B = `http://localhost:${PORT}/api`;
const STATE_FILE = ".tmp-vc-ui.json";

async function call(path, opts = {}, token = "") {
  const res = await fetch(B + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

if (process.argv[2] === "cleanup") {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const pg = (await import("pg")).default;
  const env = fs.readFileSync(".env", "utf8");
  const pool = new pg.Pool({
    connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
    ssl: { rejectUnauthorized: false },
  });
  await pool.query("DELETE FROM business WHERE id = $1", [state.businessId]);
  const left = await pool.query(
    "SELECT count(*)::int AS n FROM virtual_consultation WHERE business_id = $1",
    [state.businessId]
  );
  const patientsLeft = await pool.query(
    "SELECT count(*)::int AS n FROM patient WHERE business_id = $1",
    [state.businessId]
  );
  console.log(
    `cleanup: business deleted, consultations left=${left.rows[0].n}, patients left=${patientsLeft.rows[0].n}`
  );
  await pool.end();
  fs.rmSync(STATE_FILE, { force: true });
  process.exit(0);
}

// ---- seed ---------------------------------------------------------------
const stamp = Date.now();
const email = `vc-ui-${stamp}@example.com`;
let r = await call("/auth/signup", {
  method: "POST",
  body: JSON.stringify({
    businessName: "Derma Virtual Clinic",
    name: "Dr Hina Noor",
    email,
    password: "secret123",
  }),
});
if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.json?.message}`);
const businessId = r.json.data.business.id;

r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
const token = r.json.data.token;

const clinic = await call("/clinics", {
  method: "POST",
  body: JSON.stringify({
    clinicName: "Derma Virtual — DHA",
    city: "Karachi",
    cityCode: "KHI",
    contactNumber: "+92 300 1112223",
    fullClinicAddress: "Phase 5, DHA",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    openingTime: "10:00",
    closingTime: "19:00",
  }),
}, token);
const clinicId = clinic.json.data.id;
const doctor = await call("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Hina Noor" }) }, token);
const doctorId = doctor.json.data.id;

r = await call("/patients", {
  method: "POST",
  body: JSON.stringify({
    fullName: "Ayesha Khan",
    gender: "Female",
    dateOfBirth: "1994-06-12",
    maritalStatus: "Married",
    phone: "+92 321 4455667",
    city: "Karachi",
  }),
}, token);
if (r.status !== 201) throw new Error(`patient failed: ${r.status} ${r.json?.message}`);
const patientId = r.json.data.id;
const patientCode = r.json.data.patient_id;

const appt = await call("/appointments", {
  method: "POST",
  body: JSON.stringify({
    patientId,
    doctorId,
    clinicId,
    appointmentDate: "2026-10-20",
    appointmentTime: "11:00",
    appointmentType: "consultation",
  }),
}, token);
const appointmentId = appt.json.data.id;

// One consultation per workflow status (5 total).
const specs = [
  { concern: "Acne & Pigmentation", status: "pending" },
  { concern: "Hair Loss", status: "accepted", linked: true },
  { concern: "Melasma", status: "in_progress", linked: true },
  { concern: "Eczema", status: "completed" },
  { concern: "Psoriasis", status: "cancelled" },
];

const created = [];
for (const spec of specs) {
  const res = await call("/virtual-consultations", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      appointmentId: spec.linked ? appointmentId : null,
      concern: spec.concern,
      preferredDateTime: spec.linked ? "2026-10-15T14:30" : null,
      notes: spec.linked ? "Prefers evening slot" : null,
    }),
  }, token);
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.json?.message}`);
  const row = res.json.data;

  // Walk the workflow through the REAL API (valid transitions only).
  const walk = {
    accepted: ["accepted"],
    in_progress: ["accepted", "in_progress"],
    completed: ["accepted", "in_progress", "completed"],
    cancelled: ["cancelled"],
  }[spec.status] ?? [];
  for (const next of walk) {
    const p = await call(`/virtual-consultations/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    }, token);
    if (p.status !== 200) throw new Error(`patch ${next} failed: ${p.status} ${p.json?.message}`);
  }
  created.push({ id: row.id, consultationId: row.consultationId, status: spec.status });
}

fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({ email, token, businessId, patientId, patientCode, appointmentId, created }, null, 2)
);
console.log(
  `seeded ${created.length} consultations: ${created.map((c) => `${c.consultationId}=${c.status}`).join(", ")} -> ${STATE_FILE}`
);
