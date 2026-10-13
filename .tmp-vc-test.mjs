/**
 * API E2E TEST — /api/virtual-consultations (VC module).
 * Requires the dev server on :3010 or TEST_PORT and the local PostgreSQL.
 * Run: TEST_PORT=3000 node .tmp-vc-test.mjs
 *
 * Exit code 0 = all checks passed.
 */
const PORT = process.env.TEST_PORT || "3010";
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

const VC_RE = /^VC-\d{8}-\d{4}$/;

const stamp = Date.now();
const businesses = [];

async function signup(label) {
  const email = `vc-test-${label}-${stamp}@example.com`;
  let r = await call("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: `VC Test ${label} ${stamp}`,
      name: "Dr VC Tester",
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
  return r.json.data; // { id, patient_id, ... }
}

async function seedAppointment(token, patientId) {
  const clinic = await call("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "VC Test Clinic",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Block 4, Clifton",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "10:00",
      closingTime: "19:00",
    }),
  }, token);
  const doctor = await call("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Skin" }) }, token);
  const appt = await call("/appointments", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      doctorId: doctor.json.data.id,
      clinicId: clinic.json.data.id,
      appointmentDate: "2026-10-20",
      appointmentTime: "11:00",
      appointmentType: "consultation",
    }),
  }, token);
  if (appt.status !== 201) throw new Error(`appointment failed: ${appt.status} ${appt.json?.message}`);
  return appt.json.data;
}

async function create(token, body) {
  return call("/virtual-consultations", { method: "POST", body: JSON.stringify(body) }, token);
}

async function main() {
  // ---- setup ----
  const A = await signup("a");
  const patientA = await seedPatient(A.token);
  const apptA = await seedAppointment(A.token, patientA.id);
  const Bz = await signup("b");
  const patientB = await seedPatient(Bz.token, "+92 321 9998887");

  // ---- 1. create ----
  let r = await create(A.token, { patientId: patientA.id, concern: "Acne & Pigmentation" });
  check("C1  create returns 201 + envelope", r.status === 201 && envelopeOk(r), `${r.status} ${r.json?.message}`);
  const c1 = r.json.data;
  check("C2  VC-YYYYMMDD-NNNN format", VC_RE.test(c1?.consultationId ?? ""), c1?.consultationId);
  check("C3  starts as pending", c1?.status === "pending" && c1?.statusLabel === "PENDING");
  check("C4  patient data JOINed (name/phone/code)", 
    c1?.patientName === "Muhammad Ahmed" && c1?.phone === "+92 300 1112223" && (c1?.patientCode ?? "").startsWith("PT-"),
    `${c1?.patientName} / ${c1?.phone} / ${c1?.patientCode}`);
  check("C5  no appointment linked -> nulls (nothing faked)",
    c1?.appointmentId === null && c1?.appointmentCode === null && c1?.doctorName === null && c1?.clinicName === null);

  r = await create(A.token, { patientId: patientA.id, concern: "Hair Loss", preferredDateTime: "2026-10-15T14:30", notes: "Wants evening slot" });
  const c2 = r.json.data;
  const seqOf = (c) => Number((c?.consultationId ?? "").split("-")[2]);
  check("C6  second consultation draws the NEXT sequence number",
    r.status === 201 && seqOf(c2) === seqOf(c1) + 1, `${c1?.consultationId} -> ${c2?.consultationId}`);
  check("C7  preferred date/time stored as ISO", typeof c2?.preferredDateTime === "string" && c2.preferredDateTime.includes("T"), c2?.preferredDateTime);

  r = await create(A.token, { patientId: patientA.id, concern: "Melasma", appointmentId: apptA.id });
  const c3 = r.json.data;
  check("C8  appointment link stored", r.status === 201 && c3?.appointmentId === apptA.id, `${r.status}`);
  check("C9  related doctor + clinic resolved through the appointment",
    typeof c3?.appointmentCode === "string" && c3.appointmentCode.startsWith("APT-") &&
    c3?.doctorName === "Dr Skin" && c3?.clinicName === "VC Test Clinic",
    `${c3?.appointmentCode} / ${c3?.doctorName} / ${c3?.clinicName}`);

  // ---- 2. list ----
  r = await call("/virtual-consultations", {}, A.token);
  check("L1  GET list 200 + envelope + 3 rows, newest first",
    r.status === 200 && envelopeOk(r) && Array.isArray(r.json.data) && r.json.data.length === 3 &&
    r.json.data[0].consultationId === c3.consultationId,
    `n=${r.json?.data?.length}`);
  const ids = r.json.data.map((x) => x.consultationId);
  check("L2  all VC ids unique", new Set(ids).size === 3, ids.join(","));

  // ---- 3. valid workflow transitions ----
  r = await call(`/virtual-consultations/${c1.id}`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, A.token);
  check("W1  pending -> accepted = 200", r.status === 200 && r.json.data?.status === "accepted", `${r.status}`);
  r = await call(`/virtual-consultations/${c1.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }, A.token);
  check("W2  accepted -> in_progress = 200", r.status === 200 && r.json.data?.status === "in_progress", `${r.status}`);
  r = await call(`/virtual-consultations/${c1.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }, A.token);
  check("W3  in_progress -> completed = 200", r.status === 200 && r.json.data?.status === "completed", `${r.status}`);

  // cancel from pending
  r = await call(`/virtual-consultations/${c2.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }, A.token);
  check("W4  pending -> cancelled = 200", r.status === 200 && r.json.data?.status === "cancelled", `${r.status}`);
  // cancel from accepted
  await call(`/virtual-consultations/${c3.id}`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, A.token);
  r = await call(`/virtual-consultations/${c3.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }, A.token);
  check("W5  accepted -> cancelled = 200", r.status === 200 && r.json.data?.status === "cancelled", `${r.status}`);

  // ---- 4. invalid transitions (server-enforced) ----
  r = await call(`/virtual-consultations/${c1.id}`, { method: "PATCH", body: JSON.stringify({ status: "pending" }) }, A.token);
  check("W6  completed -> pending rejected", r.status === 400, `${r.status}`);
  r = await call(`/virtual-consultations/${c1.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }, A.token);
  check("W7  completed -> in_progress rejected", r.status === 400, `${r.status}`);
  r = await call(`/virtual-consultations/${c3.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }, A.token);
  check("W8  cancelled -> completed rejected", r.status === 400, `${r.status}`);
  r = await call(`/virtual-consultations/${c3.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }, A.token);
  check("W9  same-status update rejected (no fake no-op)", r.status === 400, `${r.status}`);
  r = await call(`/virtual-consultations/${c3.id}`, { method: "PATCH", body: JSON.stringify({ status: "banana" }) }, A.token);
  check("W10 unknown status value rejected", r.status === 400, `${r.status}`);

  // ---- 5. validation ----
  r = await create(A.token, { patientId: patientA.id, concern: "" });
  check("V1  missing concern -> 400 + field error", r.status === 400 && Boolean(r.json.data?.errors?.concern), JSON.stringify(r.json?.data?.errors));
  r = await create(A.token, { concern: "Acne" });
  check("V2  missing patient -> 400 + field error", r.status === 400 && Boolean(r.json.data?.errors?.patientId));
  r = await create(A.token, { patientId: "11111111-2222-3333-4444-555555555555", concern: "Acne" });
  check("V3  patient of another business rejected", r.status === 400 && Boolean(r.json.data?.errors?.patientId), `${r.status}`);
  r = await create(A.token, { patientId: patientA.id, concern: "Acne", preferredDateTime: "not-a-date" });
  check("V4  invalid preferred date -> 400", r.status === 400 && Boolean(r.json.data?.errors?.preferredDateTime), `${r.status}`);
  // appointment of another patient (patientB's appointment against patientA)
  const apptB = await seedAppointment(Bz.token, patientB.id);
  r = await create(A.token, { patientId: patientA.id, concern: "Acne", appointmentId: apptA.id });
  const goodAppt = r.status === 201; // same patient+business is fine (already covered in C8); re-create would add a row — delete below
  if (goodAppt) await call(`/virtual-consultations/${r.json.data.id}`, { method: "DELETE" }, A.token);
  r = await create(A.token, { patientId: patientA.id, concern: "Acne", appointmentId: apptB.id });
  check("V5  appointment of another business/patient rejected", r.status === 400, `${r.status}`);

  // ---- 6. business isolation ----
  const listB = await call("/virtual-consultations", {}, Bz.token);
  check("I1  business B sees only its own consultations",
    listB.status === 200 && Array.isArray(listB.json.data) && listB.json.data.length === 0,
    `n=${listB.json?.data?.length}`);
  const madeB = await create(Bz.token, { patientId: patientB.id, concern: "Psoriasis" });
  const cb = madeB.json.data;
  const listB2 = await call("/virtual-consultations", {}, Bz.token);
  check("I2  business B now sees exactly its own 1 row",
    listB2.json.data?.length === 1 && listB2.json.data[0].id === cb.id);

  r = await call(`/virtual-consultations/${c2.id}`, {}, Bz.token);
  check("I3  business B cannot GET A's consultation (404)", r.status === 404, `${r.status}`);
  r = await call(`/virtual-consultations/${c2.id}`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, Bz.token);
  check("I4  business B cannot PATCH A's consultation (404)", r.status === 404, `${r.status}`);
  r = await call(`/virtual-consultations/${c2.id}`, { method: "DELETE" }, Bz.token);
  check("I5  business B cannot DELETE A's consultation (404)", r.status === 404, `${r.status}`);
  r = await call("/virtual-consultations", {});
  check("I6  unauthenticated list rejected", r.status === 401, `${r.status}`);
  r = await call(`/virtual-consultations/not-a-uuid`, {}, A.token);
  check("I7  malformed id rejected (400)", r.status === 400, `${r.status}`);

  // ---- 7. GET single ----
  r = await call(`/virtual-consultations/${c2.id}`, {}, A.token);
  check("G1  GET single returns the consultation", r.status === 200 && r.json.data?.id === c2.id &&
    r.json.data?.consultationId === c2.consultationId, `${r.status}`);

  // ---- 8. delete semantics ----
  r = await call(`/virtual-consultations/${cb.id}`, { method: "DELETE" }, Bz.token);
  check("D1  own consultation deletes (200)", r.status === 200, `${r.status}`);
  r = await call(`/virtual-consultations/${cb.id}`, {}, Bz.token);
  check("D2  deleted consultation gone (404)", r.status === 404, `${r.status}`);
  const patStill = await call("/patients", {}, Bz.token);
  check("D3  deleting a consultation NEVER deletes the patient",
    patStill.status === 200 && (patStill.json.data ?? []).some((p) => p.id === patientB.id),
    `n=${patStill.json?.data?.length}`);

  // ---- 9. ID separation ----
  const allVC = [c1, c2, c3].map((c) => c.consultationId);
  const allCodes = [...allVC, patientA.patient_id, apptA.appointmentId];
  check("X1  VC ids never reuse PT / APT / RPT prefixes",
    allVC.every((x) => x.startsWith("VC-")) && !allCodes.some((x) => /^(PT|APT|RPT)-/.test(x) && x.startsWith("VC")),
    allCodes.join(","));
  check("X2  numbering is strictly consecutive within the run (n, n+1, n+2)",
    seqOf(c2) === seqOf(c1) + 1 && seqOf(c3) === seqOf(c2) + 1,
    allVC.join(","));

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
