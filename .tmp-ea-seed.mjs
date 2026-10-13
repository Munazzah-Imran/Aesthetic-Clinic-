/**
 * SEED for the Emergency Alerts UI test.
 * Creates a throwaway business with one patient, clinic, appointment and
 * FIVE alerts (one per workflow status, covering all four priorities):
 *   a1 critical NEW            (patient + appointment + clinic)
 *   a2 high    ACKNOWLEDGED    (patient, resolution notes prefilled)
 *   a3 medium  IN PROGRESS     (patient)
 *   a4 low     RESOLVED        (NO patient -> "—", resolution notes)
 *   a5 critical DISMISSED      (patient)
 * Plus a second, EMPTY business for the empty-state + sidebar checks.
 * State (tokens, ids, alert codes) -> .tmp-ea-ui.json
 *
 * Run: TEST_PORT=3000 node .tmp-ea-seed.mjs
 *      node .tmp-ea-seed.mjs cleanup   (deletes both businesses)
 */
const PORT = process.env.TEST_PORT || "3000";
const B = `http://localhost:${PORT}/api`;
const STATE_FILE = ".tmp-ea-ui.json";

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
  if (res.status >= 400) {
    throw new Error(`${path} -> ${res.status} ${json?.message ?? ""}`);
  }
  return json;
}

async function signup(label) {
  const email = `ea-ui-${label}-${Date.now()}@example.com`;
  const r = await call("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: `EA UI ${label} ${Date.now()}`,
      name: "Dr EA UI",
      email,
      password: "secret123",
    }),
  });
  const businessId = r.data.business.id;
  const login = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "secret123" }),
  });
  return { email, businessId, token: login.data.token };
}

async function patch(token, id, body) {
  return call(`/emergency-alerts/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
}

async function main() {
  if (process.argv[2] === "cleanup") {
    const { Pool } = await import("pg");
    const fs = await import("fs");
    const env = fs.readFileSync(".env", "utf8");
    const pool = new Pool({
      connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
      ssl: { rejectUnauthorized: false },
    });
    let count = 0;
    if (fs.existsSync(STATE_FILE)) {
      const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      const ids = [st.businessId, st.emptyBusinessId].filter(Boolean);
      if (ids.length) {
        const del = await pool.query("DELETE FROM business WHERE id = ANY($1)", [ids]);
        count = del.rowCount ?? 0;
      }
    }
    console.log(`cleanup: deleted ${count} throwaway businesses`);
    await pool.end();
    return;
  }

  const biz = await signup("main");

  const patient = await call("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Muhammad Ahmed",
      gender: "Male",
      dateOfBirth: "1992-04-04",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
    }),
  }, biz.token);

  const clinic = await call("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "EA Test Clinic",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Block 4, Clifton",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "10:00",
      closingTime: "19:00",
    }),
  }, biz.token);

  const doctor = await call("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Skin" }) }, biz.token);
  const appt = await call("/appointments", {
    method: "POST",
    body: JSON.stringify({
      patientId: patient.data.id,
      doctorId: doctor.data.id,
      clinicId: clinic.data.id,
      appointmentDate: "2026-10-20",
      appointmentTime: "11:00",
      appointmentType: "consultation",
    }),
  }, biz.token);

  const create = (body) => call("/emergency-alerts", { method: "POST", body: JSON.stringify(body) }, biz.token);

  const a1 = await create({
    patientId: patient.data.id,
    appointmentId: appt.data.id,
    clinicId: clinic.data.id,
    priority: "critical",
    message: "Severe allergic reaction with facial swelling — needs immediate dermatologist review.",
  });
  const a2 = await create({
    patientId: patient.data.id,
    priority: "high",
    message: "Patient reports rapid spread of hives after starting a new medication.",
  });
  const a3 = await create({
    patientId: patient.data.id,
    priority: "medium",
    message: "Acute psoriasis flare with bleeding — patient requests urgent care.",
  });
  const a4 = await create({
    priority: "low",
    message: "General sunburn case reported at reception — no patient linked yet.",
  });
  const a5 = await create({
    patientId: patient.data.id,
    priority: "critical",
    message: "Persistent itching and rashes across both arms for three days.",
  });

  await patch(biz.token, a2.data.id, {
    status: "acknowledged",
    resolutionNotes: "Awaiting dermatologist confirmation.",
  });
  await patch(biz.token, a3.data.id, { status: "acknowledged" });
  await patch(biz.token, a3.data.id, { status: "in_progress" });
  await patch(biz.token, a4.data.id, { status: "acknowledged" });
  await patch(biz.token, a4.data.id, { status: "in_progress" });
  await patch(biz.token, a4.data.id, { status: "resolved", resolutionNotes: "Advised patient to visit the clinic." });
  await patch(biz.token, a5.data.id, { status: "dismissed" });

  const empty = await signup("empty");

  const list = await call("/emergency-alerts", {}, biz.token);
  const state = {
    email: biz.email,
    token: biz.token,
    businessId: biz.businessId,
    patientId: patient.data.id,
    appointmentId: appt.data.id,
    appointmentCode: appt.data.appointmentId,
    clinicName: clinic.data.clinic_name ?? "EA Test Clinic",
    alertIds: [a1.data.id, a2.data.id, a3.data.id, a4.data.id, a5.data.id],
    alerts: list.data.map((x) => ({ id: x.id, alertId: x.alertId, status: x.status, priority: x.priority, createdAt: x.createdAt })),
    emptyEmail: empty.email,
    emptyToken: empty.token,
    emptyBusinessId: empty.businessId,
  };
  const fs = await import("fs");
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(`seeded ${list.data.length} alerts -> ${STATE_FILE}`);
  console.log(state.alerts.map((x) => `${x.alertId} ${x.priority} ${x.status}`).join("\n"));
}

main().catch((err) => {
  console.error("SEED ERROR:", err);
  process.exit(1);
});
