/**
 * API E2E TEST — /api/emergency-alerts (Emergency Alerts module).
 * Requires the dev server on :3000 (or TEST_PORT) and the configured PostgreSQL.
 * Run: TEST_PORT=3000 node .tmp-ea-test.mjs
 *
 * Exit code 0 = all checks passed.
 */
const PORT = process.env.TEST_PORT || "3000";
const B = `http://localhost:${PORT}/api`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

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

const envelopeOk = (r) =>
  r.json && typeof r.json === "object" &&
  "data" in r.json && "error" in r.json && "success" in r.json && "message" in r.json;

const ALR_RE = /^ALR-\d{8}-\d{4}$/;

const stamp = Date.now();
const businesses = [];

async function signup(label) {
  const email = `ea-test-${label}-${stamp}@example.com`;
  let r = await call("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: `EA Test ${label} ${stamp}`,
      name: "Dr EA Tester",
      email,
      password: "secret123",
    }),
  });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.json?.message}`);
  const businessId = r.json.data.business.id;
  r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
  const token = r.json.data.token;
  businesses.push({ businessId, email });
  return { businessId, token };
}

async function seedPatient(token, phone = "+92 300 1112223") {
  const r = await call("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Muhammad Ahmed",
      gender: "Male",
      dateOfBirth: "1992-04-04",
      maritalStatus: "Single",
      phone,
      city: "Karachi",
    }),
  }, token);
  if (r.status !== 201) throw new Error(`patient failed: ${r.status} ${r.json?.message}`);
  return r.json.data;
}

async function seedClinic(token, name = "EA Test Clinic") {
  const r = await call("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: name,
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Block 4, Clifton",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "10:00",
      closingTime: "19:00",
    }),
  }, token);
  if (r.status !== 201) throw new Error(`clinic failed: ${r.status} ${r.json?.message}`);
  return r.json.data;
}

async function seedAppointment(token, patientId, clinicId) {
  const doctor = await call("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Skin" }) }, token);
  const appt = await call("/appointments", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      doctorId: doctor.json.data.id,
      clinicId,
      appointmentDate: "2026-10-20",
      appointmentTime: "11:00",
      appointmentType: "consultation",
    }),
  }, token);
  if (appt.status !== 201) throw new Error(`appointment failed: ${appt.status} ${appt.json?.message}`);
  return appt.json.data;
}

async function create(token, body) {
  return call("/emergency-alerts", { method: "POST", body: JSON.stringify(body) }, token);
}

async function main() {
  // ---- setup ----
  const A = await signup("a");
  const patientA = await seedPatient(A.token);
  const clinicA = await seedClinic(A.token);
  const apptA = await seedAppointment(A.token, patientA.id, clinicA.id);
  const Bz = await signup("b");
  const patientB = await seedPatient(Bz.token, "+92 321 9998887");

  // ---- 1. create ----
  let r = await create(A.token, {
    patientId: patientA.id,
    appointmentId: apptA.id,
    clinicId: clinicA.id,
    priority: "critical",
    message: "Severe allergic reaction with swelling — needs immediate review.",
  });
  check("C1  create returns 201 + envelope", r.status === 201 && envelopeOk(r), `${r.status} ${r.json?.message}`);
  const a1 = r.json.data;

  check("C2  ALR-YYYYMMDD-NNNN format", ALR_RE.test(a1?.alertId ?? ""), a1?.alertId);
  check("C3  starts as new + label", a1?.status === "new" && a1?.statusLabel === "New");
  check("C4  priority stored", a1?.priority === "critical" && a1?.priorityLabel === "Critical", a1?.priority);
  check("C5  patient data JOINed (name/phone/code)",
    a1?.patientName === "Muhammad Ahmed" && a1?.phone === "+92 300 1112223" && (a1?.patientCode ?? "").startsWith("PT-"),
    `${a1?.patientName} / ${a1?.phone} / ${a1?.patientCode}`);
  check("C6  appointment + clinic linked",
    (a1?.appointmentCode ?? "").startsWith("APT-") && a1?.clinicName === "EA Test Clinic",
    `${a1?.appointmentCode} / ${a1?.clinicName}`);

  r = await create(A.token, { priority: "low", message: "General alert, no patient." });
  const a2 = r.json.data;
  const seqOf = (a) => Number((a?.alertId ?? "").split("-")[2]);
  check("C7  second alert draws the NEXT sequence number",
    r.status === 201 && seqOf(a2) === seqOf(a1) + 1, `${a1?.alertId} -> ${a2?.alertId}`);
  check("C8  patient optional -> nulls (nothing faked)",
    r.status === 201 && a2?.patientId === null && a2?.patientName === null && a2?.phone === null &&
    a2?.appointmentId === null && a2?.clinicId === null && a2?.clinicName === null);

  r = await create(A.token, { priority: "medium", message: "Third consecutive alert." });
  const a3 = r.json.data;
  r = await create(A.token, {
    patientId: patientA.id,
    appointmentId: apptA.id,
    priority: "high",
    message: "Appointment-related flare-up reported by phone.",
  });
  const a4 = r.json.data;
  check("C9  numbering strictly consecutive (n, n+1, n+2, n+3)",
    [a2, a3, a4].every((x, i) => seqOf(x) === seqOf(a1) + i + 1),
    [a1, a2, a3, a4].map((x) => x?.alertId).join(","));
  check("C10 clinic falls back to the appointment's clinic when none set directly",
    a4?.clinicId === null && a4?.clinicName === "EA Test Clinic", `${a4?.clinicId} / ${a4?.clinicName}`);

  // ---- 2. list ----
  r = await call("/emergency-alerts", {}, A.token);
  check("L1  GET list 200 + envelope + 4 rows, newest first",
    r.status === 200 && envelopeOk(r) && Array.isArray(r.json.data) && r.json.data.length === 4 &&
    r.json.data[0].alertId === a4.alertId,
    `n=${r.json?.data?.length}`);
  const ids = r.json.data.map((x) => x.alertId);
  check("L2  all alert ids unique", new Set(ids).size === 4, ids.join(","));

  // ---- 3. valid workflow transitions ----
  r = await call(`/emergency-alerts/${a1.id}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) }, A.token);
  check("W1  new -> acknowledged = 200 + envelope", r.status === 200 && envelopeOk(r) && r.json.data?.status === "acknowledged", `${r.status}`);
  r = await call(`/emergency-alerts/${a1.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }, A.token);
  check("W2  acknowledged -> in_progress = 200", r.status === 200 && r.json.data?.status === "in_progress", `${r.status}`);
  r = await call(`/emergency-alerts/${a1.id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) }, A.token);
  check("W3  in_progress -> resolved = 200 + resolvedAt stamped",
    r.status === 200 && r.json.data?.status === "resolved" &&
    typeof r.json.data?.resolvedAt === "string" && r.json.data.resolvedAt.includes("T"),
    `${r.status} ${r.json?.data?.resolvedAt}`);
  r = await call(`/emergency-alerts/${a3.id}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }, A.token);
  check("W4  new -> dismissed = 200", r.status === 200 && r.json.data?.status === "dismissed", `${r.status}`);

  // ---- 4. invalid transitions (server-enforced) ----
  r = await call(`/emergency-alerts/${a2.id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) }, A.token);
  check("W5  new -> resolved rejected (no skipping)", r.status === 400, `${r.status}`);
  r = await call(`/emergency-alerts/${a2.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }, A.token);
  check("W6  new -> in_progress rejected", r.status === 400, `${r.status}`);
  r = await call(`/emergency-alerts/${a1.id}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) }, A.token);
  check("W7  resolved is terminal (-> acknowledged rejected)", r.status === 400, `${r.status}`);
  r = await call(`/emergency-alerts/${a3.id}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) }, A.token);
  check("W8  dismissed is terminal (-> acknowledged rejected)", r.status === 400, `${r.status}`);
  r = await call(`/emergency-alerts/${a2.id}`, { method: "PATCH", body: JSON.stringify({ status: "new" }) }, A.token);
  check("W9  same-status update rejected (no fake no-op)", r.status === 400, `${r.status}`);
  r = await call(`/emergency-alerts/${a2.id}`, { method: "PATCH", body: JSON.stringify({ status: "banana" }) }, A.token);
  check("W10 unknown status value rejected", r.status === 400, `${r.status}`);

  // ---- 5. resolution notes semantics ----
  r = await call(`/emergency-alerts/${a2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "acknowledged", resolutionNotes: "Triage started." }),
  }, A.token);
  check("W11 notes stored with the transition",
    r.status === 200 && r.json.data?.status === "acknowledged" && r.json.data?.resolutionNotes === "Triage started.",
    `${r.status} ${r.json?.data?.resolutionNotes}`);
  r = await call(`/emergency-alerts/${a2.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }, A.token);
  check("W12 absent notes key leaves stored notes untouched",
    r.status === 200 && r.json.data?.resolutionNotes === "Triage started.", `${r.status} ${r.json?.data?.resolutionNotes}`);
  r = await call(`/emergency-alerts/${a2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", resolutionNotes: "" }),
  }, A.token);
  check("W13 empty notes normalize to null on resolve",
    r.status === 200 && r.json.data?.resolutionNotes === null && typeof r.json.data?.resolvedAt === "string",
    `${r.status} ${r.json?.data?.resolutionNotes}`);

  // ---- 6. persistence (fresh read from PostgreSQL) ----
  r = await call(`/emergency-alerts/${a1.id}`, {}, A.token);
  check("P1  GET single returns the persisted resolved alert",
    r.status === 200 && r.json.data?.status === "resolved" && r.json.data?.alertId === a1.alertId, `${r.status}`);

  // ---- 7. validation ----
  r = await create(A.token, { priority: "high" });
  check("V1  missing message -> 400 + field error", r.status === 400 && Boolean(r.json.data?.errors?.message), JSON.stringify(r.json?.data?.errors));
  r = await create(A.token, { message: "Something urgent" });
  check("V2  missing priority -> 400 + field error", r.status === 400 && Boolean(r.json.data?.errors?.priority), JSON.stringify(r.json?.data?.errors));
  r = await create(A.token, { priority: "urgent", message: "Something urgent" });
  check("V3  unknown priority value -> 400", r.status === 400 && Boolean(r.json.data?.errors?.priority), `${r.status}`);
  r = await create(A.token, { priority: "high", message: "x" });
  check("V4  message shorter than 2 chars -> 400", r.status === 400 && Boolean(r.json.data?.errors?.message), `${r.status}`);
  r = await create(A.token, { priority: "high", message: "a".repeat(2001) });
  check("V5  message over 2000 chars -> 400", r.status === 400 && Boolean(r.json.data?.errors?.message), `${r.status}`);
  r = await create(A.token, { patientId: "11111111-2222-3333-4444-555555555555", priority: "high", message: "Cross business patient" });
  check("V6  patient of another business rejected", r.status === 400 && Boolean(r.json.data?.errors?.patientId), `${r.status}`);
  r = await create(Bz.token, { patientId: patientA.id, priority: "high", message: "Cross business patient" });
  check("V7  business B cannot use business A's patient", r.status === 400 && Boolean(r.json.data?.errors?.patientId), `${r.status}`);
  r = await create(Bz.token, { appointmentId: apptA.id, priority: "high", message: "Cross business appointment" });
  check("V8  business B cannot use business A's appointment", r.status === 400 && Boolean(r.json.data?.errors?.appointmentId), `${r.status}`);
  r = await create(Bz.token, { clinicId: clinicA.id, priority: "high", message: "Cross business clinic" });
  check("V9  business B cannot use business A's clinic", r.status === 400 && Boolean(r.json.data?.errors?.clinicId), `${r.status}`);

  // ---- 8. business isolation ----
  const madeB = await create(Bz.token, { patientId: patientB.id, priority: "high", message: "B's own alert." });
  const ab = madeB.json.data;
  const listB = await call("/emergency-alerts", {}, Bz.token);
  check("I1  business B sees exactly its own 1 row",
    listB.status === 200 && Array.isArray(listB.json.data) && listB.json.data.length === 1 &&
    listB.json.data[0].id === ab.id,
    `n=${listB.json?.data?.length}`);
  const listA = await call("/emergency-alerts", {}, A.token);
  check("I2  business A unaffected (still 4 rows, no B's alert)",
    listA.json.data?.length === 4 && !listA.json.data.some((x) => x.id === ab.id),
    `n=${listA.json?.data?.length}`);
  r = await call(`/emergency-alerts/${a1.id}`, {}, Bz.token);
  check("I3  business B cannot GET A's alert (404)", r.status === 404, `${r.status}`);
  r = await call(`/emergency-alerts/${a1.id}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }, Bz.token);
  check("I4  business B cannot PATCH A's alert (404)", r.status === 404, `${r.status}`);
  r = await call("/emergency-alerts");
  check("I5  unauthenticated list rejected", r.status === 401, `${r.status}`);
  r = await create(undefined, { priority: "high", message: "no auth" });
  check("I6  unauthenticated create rejected", r.status === 401, `${r.status}`);
  r = await call("/emergency-alerts/not-a-uuid", {}, A.token);
  check("I7  malformed id rejected (400)", r.status === 400, `${r.status}`);

  // ---- 9. ID separation ----
  const allA = [a1, a2, a3, a4].map((x) => x.alertId);
  check("X1  alert ids never reuse PT / APT / RPT / VC prefixes",
    allA.every((x) => x.startsWith("ALR-")) &&
    ![patientA.patient_id, apptA.appointmentId].some((x) => x.startsWith("ALR-")),
    [...allA, patientA.patient_id, apptA.appointmentId].join(","));
  check("X2  ALR sequence continues across businesses (B draws after A)",
    Number(ab?.alertId?.split("-")[2]) > seqOf(a4), `${ab?.alertId} after ${a4?.alertId}`);

  // ---- cleanup ----
  return { businesses };
}

main()
  .then(async ({ businesses }) => {
    // Remove throwaway businesses (FK cascade cleans every test row).
    const { Pool } = await import("pg");
    const env = (await import("fs")).readFileSync(".env", "utf8");
    const pool = new Pool({
      connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
      ssl: { rejectUnauthorized: false },
    });
    const ids = businesses.map((b) => b.businessId);
    const del = await pool.query("DELETE FROM business WHERE id = ANY($1)", [ids]);
    console.log(`cleanup: deleted ${del.rowCount} throwaway businesses`);
    await pool.end();
    const failed = results.filter((x) => x.startsWith("FAIL"));
    console.log(results.join("\n"));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(results.join("\n"));
    console.error("TEST RUNNER ERROR:", err);
    process.exit(1);
  });
