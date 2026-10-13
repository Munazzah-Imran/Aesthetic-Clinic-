/**
 * Seeds a throwaway business with real uploaded reports for the UI test
 * (screenshots), writing credentials to .tmp-reports-ui.json.
 * Run: node .tmp-reports-seed.mjs   (server on :3010 or TEST_PORT)
 * Wipe afterwards: node .tmp-reports-seed.mjs cleanup
 */
import fs from "fs";

const PORT = process.env.TEST_PORT || "3010";
const B = `http://localhost:${PORT}/api`;
const STATE_FILE = ".tmp-reports-ui.json";

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

// ---- demo files ----------------------------------------------------------
// A skin-lesion-style placeholder photo (SVG renders in <img> previews).
const photoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
  <defs><radialGradient id="g" cx="45%" cy="40%" r="75%">
    <stop offset="0%" stop-color="#f3d9b8"/><stop offset="60%" stop-color="#e8bd93"/>
    <stop offset="100%" stop-color="#c99873"/></radialGradient></defs>
  <rect width="640" height="420" fill="url(#g)"/>
  <circle cx="330" cy="205" r="62" fill="#b4553f" opacity="0.75"/>
  <circle cx="330" cy="205" r="34" fill="#8f3b2c" opacity="0.85"/>
  <text x="20" y="400" font-family="Arial" font-size="18" fill="#5b3a2a">Right cheek — follow-up capture</text>
</svg>`;
const photoDataUrl = `data:image/svg+xml;base64,${Buffer.from(photoSvg, "utf8").toString("base64")}`;

const makePdf = (title, lines) => {
  const body =
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n` +
    `trailer<</Root 1 0 R>>\n%%EOF\n${title}\n${lines.join("\n")}\n`;
  return `data:application/pdf;base64,${Buffer.from(body, "utf8").toString("base64")}`;
};

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
    "SELECT count(*)::int AS n FROM uploaded_report WHERE business_id = $1",
    [state.businessId]
  );
  const patientsLeft = await pool.query(
    "SELECT count(*)::int AS n FROM patient WHERE business_id = $1",
    [state.businessId]
  );
  console.log(
    `cleanup: business deleted, reports left=${left.rows[0].n}, patients left=${patientsLeft.rows[0].n}`
  );
  await pool.end();
  fs.rmSync(STATE_FILE, { force: true });
  process.exit(0);
}

// ---- seed ---------------------------------------------------------------
const stamp = Date.now();
const email = `reports-ui-${stamp}@example.com`;
let r = await call("/auth/signup", {
  method: "POST",
  body: JSON.stringify({
    businessName: "Derma Vision Clinic",
    name: "Dr Sana Ali",
    email,
    password: "secret123",
  }),
});
if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.json?.message}`);
const businessId = r.json.data.business.id;

r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
const token = r.json.data.token;

r = await call(
  "/clinics",
  {
    method: "POST",
    body: JSON.stringify({
      clinicName: "Derma Vision — Clifton",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Block 4, Clifton",
      workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      openingTime: "10:00",
      closingTime: "19:00",
    }),
  },
  token
);
const clinicId = r.json.data.id;
r = await call("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Sana Ali" }) }, token);
const doctorId = r.json.data.id;

r = await call(
  "/patients",
  {
    method: "POST",
    body: JSON.stringify({
      fullName: "Ayesha Khan",
      gender: "Female",
      dateOfBirth: "1994-06-12",
      maritalStatus: "Married",
      phone: "+92 321 4455667",
      city: "Karachi",
    }),
  },
  token
);
const patientId = r.json.data.id;
const patientCode = r.json.data.patient_id;

const d = new Date(Date.now() + 24 * 3600 * 1000);
const pad = (n) => String(n).padStart(2, "0");
const tomorrow = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

r = await call(
  "/appointments",
  {
    method: "POST",
    body: JSON.stringify({
      patientId,
      doctorId,
      clinicId,
      appointmentDate: tomorrow,
      appointmentTime: "11:00",
      appointmentType: "consultation",
    }),
  },
  token
);
const appointmentId = r.json.data.id;
console.log(`patient=${patientCode} appointment=${r.json.data.appointmentId}`);

const uploads = [
  {
    patientId,
    appointmentId,
    documentType: "skin_photo",
    fileName: "facial-lesion-followup.png",
    fileData: photoDataUrl,
  },
  {
    patientId,
    documentType: "lab_report",
    fileName: "dermatology-culture-final-report.pdf",
    fileData: makePdf("LAB REPORT", ["Culture & Sensitivity", "Staphylococcus aureus"]),
  },
  {
    patientId,
    appointmentId,
    documentType: "prescription",
    fileName: "rx-isotretinoin-course.pdf",
    fileData: makePdf("PRESCRIPTION", ["Isotretinoin 20mg", "Once daily — 30 days"]),
  },
];

const created = [];
for (const u of uploads) {
  const res = await call("/reports", { method: "POST", body: JSON.stringify(u) }, token);
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${res.json?.message}`);
  created.push(res.json.data.reportId);
}

fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({ email, token, businessId, patientId, appointmentId, reports: created }, null, 2)
);
console.log(`seeded ${created.length} reports: ${created.join(", ")} -> ${STATE_FILE}`);
