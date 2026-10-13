/**
 * END-TO-END TEST — Uploaded Reports / Images module.
 *
 * Verifies against the real database + running dev server:
 *  1.  POST /api/reports stores an image + a PDF and generates
 *      RPT-YYYYMMDD-NNNN on the BACKEND (never client-chosen, unique,
 *      never reusing PT/APT numbering).
 *  2.  GET  /api/reports returns real JOINed patient name/phone and the
 *      APT appointment token ("—" when no appointment is linked).
 *  3.  GET  /api/reports/[id]/file streams the original bytes behind
 *      auth (+ ?download=1 sets Content-Disposition: attachment).
 *  4.  BUSINESS ISOLATION: another business's token sees an empty list,
 *      gets 404 for the file, and cannot DELETE someone else's report.
 *  5.  PATCH /api/reports/[id] moves Uploaded -> Reviewed -> Archived and
 *      rejects unknown statuses (no fake states).
 *  6.  Validation: wrong MIME type, foreign patient, appointment of another
 *      patient are all rejected with 400.
 *  7.  DELETE removes ONLY the report — patient and appointment survive.
 *
 * Creates a throwaway business, then deletes it (cascade), so no test data
 * is left behind in the real database.
 *
 * Run with:  node .tmp-reports-test.mjs   (server must run on :3010 or TEST_PORT)
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const pool = new pg.Pool({
  connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
});

const PORT = process.env.TEST_PORT || "3010";
const B = `http://localhost:${PORT}/api`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const api = async (path, opts = {}, tok = token) => {
  const res = await fetch(B + path, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      Authorization: `Bearer ${tok}`,
      ...(opts.headers || {}),
    },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, res };
};

// ---- tiny but REAL files ------------------------------------------------
// 1x1 transparent PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_DATA_URL.split(",")[1], "base64");
// minimal PDF
const PDF_BODY = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from(PDF_BODY, "utf8").toString("base64")}`;
const PDF_BYTES = Buffer.from(PDF_BODY, "utf8");

let businessId = null;
let token = null;
let otherToken = null;
let patientId = null;
let appointmentId = null;
let reportIds = [];

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const tomorrow = `${tomorrowDate.getFullYear()}-${pad(tomorrowDate.getMonth() + 1)}-${pad(tomorrowDate.getDate())}`;

try {
  // ---- 0) throwaway business + a second one for isolation ----
  const email = `reports-test-${Date.now()}@example.com`;
  let r = await api(
    "/auth/signup",
    {
      method: "POST",
      body: JSON.stringify({
        businessName: "Reports Test Clinic",
        name: "Reports Test",
        email,
        password: "secret123",
      }),
    },
    ""
  );
  check("T1  signup works", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  businessId = r.json?.data?.business?.id ?? null;

  r = await api(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password: "secret123" }) },
    ""
  );
  token = r.json?.data?.token ?? null;
  check("T2  login returns token", !!token, `status=${r.status}`);

  const email2 = `reports-test-b-${Date.now()}@example.com`;
  await api(
    "/auth/signup",
    {
      method: "POST",
      body: JSON.stringify({
        businessName: "Other Clinic",
        name: "Other",
        email: email2,
        password: "secret123",
      }),
    },
    ""
  );
  r = await api(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email: email2, password: "secret123" }) },
    ""
  );
  otherToken = r.json?.data?.token ?? null;
  check("T3  second business login", !!otherToken);

  // ---- 1) real patient + appointment (existing architecture) ----
  r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Reports Test Patient",
      gender: "Female",
      dateOfBirth: "1992-04-04",
      maritalStatus: "Single",
      phone: "+92 300 1234567",
      city: "Karachi",
    }),
  });
  check("T4  patient created", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  patientId = r.json?.data?.id ?? null;
  const patientCode = r.json?.data?.patient_id ?? "";

  r = await api("/clinics", {
    method: "POST",
    body: JSON.stringify({
      clinicName: "Reports Test Clinic Room",
      city: "Karachi",
      cityCode: "KHI",
      contactNumber: "+92 300 1112223",
      fullClinicAddress: "Test address block 456",
      workingDays: ["Monday", "Tuesday"],
      openingTime: "10:00",
      closingTime: "18:00",
    }),
  });
  const clinicId = r.json?.data?.id ?? null;
  r = await api("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Reports Test" }) });
  const doctorId = r.json?.data?.id ?? null;

  r = await api("/appointments", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      doctorId,
      clinicId,
      appointmentDate: tomorrow,
      appointmentTime: "10:00",
      appointmentType: "consultation",
    }),
  });
  check("T5  appointment created", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  appointmentId = r.json?.data?.id ?? null;
  const appointmentCode = r.json?.data?.appointmentId ?? "";

  // ---- 2) empty state first ----
  r = await api("/reports");
  check("T6  fresh business has no reports", r.status === 200 && r.json?.data?.length === 0,
    `count=${r.json?.data?.length}`);

  // ---- 3) upload an image WITH appointment ----
  r = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      appointmentId,
      documentType: "skin_photo",
      fileName: "cheek-rash-initial-photo.png",
      fileData: PNG_DATA_URL,
    }),
  });
  check("T7  image upload created (201)", r.status === 201, `status=${r.status} ${r.json?.message ?? ""}`);
  const imgReport = r.json?.data;
  if (imgReport?.id) reportIds.push(imgReport.id);
  check("T8  report ID format RPT-YYYYMMDD-NNNN",
    new RegExp(`^RPT-${today}-\\d{4}$`).test(imgReport?.reportId ?? ""),
    `got=${imgReport?.reportId}`);
  check("T9  file_url is the safe API reference",
    imgReport?.fileUrl === `/api/reports/${imgReport?.id}/file`, `got=${imgReport?.fileUrl}`);
  check("T10 status defaults to uploaded", imgReport?.status === "uploaded", `got=${imgReport?.status}`);
  check("T11 file size recorded", imgReport?.fileSize === PNG_BYTES.length,
    `got=${imgReport?.fileSize} want=${PNG_BYTES.length}`);

  // ---- 4) upload a PDF WITHOUT appointment (token must show "—") ----
  r = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      documentType: "lab_report",
      fileName: "blood-work-final-report.pdf",
      fileData: PDF_DATA_URL,
    }),
  });
  check("T12 PDF upload created", r.status === 201, `status=${r.status}`);
  const pdfReport = r.json?.data;
  if (pdfReport?.id) reportIds.push(pdfReport.id);
  check("T13 no appointment -> appointmentCode null (renders —)",
    pdfReport?.appointmentCode === null && pdfReport?.appointmentId === null,
    `got=${pdfReport?.appointmentCode}`);

  // ---- 5) list: JOINed patient data + appointment token + uniqueness ----
  r = await api("/reports");
  const list = r.json?.data ?? [];
  check("T14 list returns both reports", list.length === 2, `count=${list.length}`);
  const fromList = list.find((x) => x.id === imgReport.id);
  check("T15 patient name via JOIN", fromList?.patientName === "Reports Test Patient",
    `got=${fromList?.patientName}`);
  check("T16 patient phone via JOIN", fromList?.phone === "+92 300 1234567", `got=${fromList?.phone}`);
  check("T17 patient code via JOIN", fromList?.patientCode === patientCode, `got=${fromList?.patientCode}`);
  check("T18 appointment token via JOIN", fromList?.appointmentCode === appointmentCode,
    `got=${fromList?.appointmentCode}`);
  check("T19 document type labels", fromList?.documentTypeLabel === "Skin Photo"
    && list.find((x) => x.id === pdfReport.id)?.documentTypeLabel === "Lab Report");
  check("T20 upload timestamp present", Boolean(fromList?.uploadedAt), `got=${fromList?.uploadedAt}`);
  const ids = list.map((x) => x.reportId);
  check("T21 report IDs unique", new Set(ids).size === ids.length, ids.join(","));
  check("T22 report ID never reuses PT/APT numbering prefix",
    ids.every((i) => i.startsWith("RPT-")));
  check("T23 list never leaks file bytes",
    JSON.stringify(r.json).length < 20000 && !JSON.stringify(r.json).includes("base64"),
    `payload=${JSON.stringify(r.json).length}B`);

  // ---- 6) file streaming (auth + correct bytes) ----
  let fileRes = await fetch(`${B}/reports/${imgReport.id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const gotBytes = Buffer.from(await fileRes.arrayBuffer());
  check("T24 image file streams with image/png",
    fileRes.status === 200 && fileRes.headers.get("content-type") === "image/png",
    `status=${fileRes.status} type=${fileRes.headers.get("content-type")}`);
  check("T25 image bytes identical to upload", gotBytes.equals(PNG_BYTES),
    `got=${gotBytes.length}B want=${PNG_BYTES.length}B`);
  check("T26 file never cached shared",
    (fileRes.headers.get("cache-control") ?? "").includes("no-store"));

  fileRes = await fetch(`${B}/reports/${pdfReport.id}/file?download=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const disp = fileRes.headers.get("content-disposition") ?? "";
  const gotPdf = Buffer.from(await fileRes.arrayBuffer());
  check("T27 download=1 -> attachment with original name",
    disp.startsWith("attachment") && disp.includes("blood-work-final-report.pdf"), disp);
  check("T28 PDF bytes identical", gotPdf.equals(PDF_BYTES),
    `got=${gotPdf.length}B want=${PDF_BYTES.length}B`);

  fileRes = await fetch(`${B}/reports/${imgReport.id}/file`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  check("T29 CROSS-BUSINESS file access blocked", fileRes.status === 404, `status=${fileRes.status}`);

  fileRes = await fetch(`${B}/reports/${imgReport.id}/file`);
  check("T30 unauthenticated file access blocked", fileRes.status === 401, `status=${fileRes.status}`);

  // ---- 7) business isolation on list + delete ----
  r = await api("/reports", {}, otherToken);
  check("T31 other business sees EMPTY list", r.status === 200 && r.json?.data?.length === 0,
    `count=${r.json?.data?.length}`);
  r = await api(`/reports/${imgReport.id}`, { method: "DELETE" }, otherToken);
  check("T32 other business cannot delete (404)", r.status === 404, `status=${r.status}`);

  // ---- 8) status workflow (only real states) ----
  r = await api(`/reports/${imgReport.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "reviewed" }),
  });
  check("T33 PATCH uploaded -> reviewed", r.status === 200 && r.json?.data?.status === "reviewed",
    `status=${r.status} got=${r.json?.data?.status}`);
  r = await api(`/reports/${imgReport.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  check("T34 PATCH reviewed -> archived", r.status === 200 && r.json?.data?.status === "archived",
    `status=${r.status}`);
  r = await api(`/reports/${imgReport.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "processing" }),
  });
  check("T35 fake 'processing' status rejected", r.status === 400, `status=${r.status}`);

  // ---- 9) validation rejections ----
  r = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      documentType: "other",
      fileName: "evil.exe",
      fileData: "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA",
    }),
  });
  check("T36 disallowed file type rejected", r.status === 400, `status=${r.status}`);
  r = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      patientId: "00000000-0000-4000-8000-000000000000",
      documentType: "other",
      fileName: "x.pdf",
      fileData: PDF_DATA_URL,
    }),
  });
  check("T37 foreign patient rejected", r.status === 400, `status=${r.status}`);
  r = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      appointmentId: "00000000-0000-4000-8000-000000000000",
      documentType: "other",
      fileName: "x.pdf",
      fileData: PDF_DATA_URL,
    }),
  });
  check("T38 bogus appointment rejected", r.status === 400, `status=${r.status}`);

  // ---- 10) DB-level checks: report_id generated by the sequence, relationships ----
  const dbRow = await pool.query(
    `SELECT r.report_id, r.status, r.file_url, r.file_data IS NOT NULL AS has_bytes,
            p.full_name, p.id AS patient_ref, a.id AS appointment_ref
       FROM uploaded_report r
       JOIN patient p ON p.id = r.patient_id
       LEFT JOIN appointment a ON a.id = r.appointment_id
      WHERE r.id = $1`,
    [imgReport.id]
  );
  const db = dbRow.rows[0];
  check("T39 report_id persisted in PostgreSQL", db?.report_id === imgReport.reportId,
    `db=${db?.report_id}`);
  check("T40 file bytes stored with the row", db?.has_bytes === true);
  check("T41 references EXISTING patient row (no duplicate table)",
    db?.patient_ref === patientId);
  check("T42 references EXISTING appointment row", db?.appointment_ref === appointmentId);

  const seq = await pool.query(
    `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next FROM report_id_sequence`
  );
  check("T43 report_id_sequence exists and advanced",
    Number(seq.rows[0].next) > 1, `next=${seq.rows[0].next}`);

  // ---- 11) DELETE removes only the report ----
  r = await api(`/reports/${pdfReport.id}`, { method: "DELETE" });
  check("T44 DELETE succeeds", r.status === 200 && r.json?.success === true,
    `status=${r.status}`);
  r = await api(`/reports/${pdfReport.id}`, { method: "DELETE" });
  check("T45 second DELETE -> 404", r.status === 404, `status=${r.status}`);
  r = await api("/reports");
  check("T46 row removed from table", r.json?.data?.length === 1, `count=${r.json?.data?.length}`);

  const patientStill = await pool.query("SELECT 1 FROM patient WHERE id = $1", [patientId]);
  check("T47 patient NOT deleted with the report", (patientStill.rowCount ?? 0) === 1);
  const appointmentStill = await pool.query("SELECT 1 FROM appointment WHERE id = $1", [appointmentId]);
  check("T48 appointment NOT deleted with the report", (appointmentStill.rowCount ?? 0) === 1);

  const orphan = await pool.query("SELECT 1 FROM uploaded_report WHERE id = $1", [pdfReport.id]);
  check("T49 stored file removed together with the row", (orphan.rowCount ?? 0) === 0);
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  // ---- CLEANUP: cascade-delete the throwaway businesses ----
  try {
    for (const bid of [
      businessId,
    ]) {
      if (bid) await pool.query("DELETE FROM business WHERE id = $1", [bid]);
    }
    await pool.query(
      "DELETE FROM business WHERE business_name IN ('Reports Test Clinic', 'Other Clinic')"
    );
  } catch (err) {
    console.error("cleanup failed:", err);
  }
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
console.log("\nALL TESTS PASSED");
