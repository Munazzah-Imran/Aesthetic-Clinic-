/**
 * Live API test for the Patient Contact Information requirements:
 *  1. Patient with only required fields (Contact Number + City filled,
 *     Alternate Phone / Email / Full Address blank) must save successfully.
 *  2. Blank optional fields must be stored as SQL NULL (not "").
 *  3. Contact Number / City stay required; missing -> 400.
 *  4. Provided optional values are stored normally.
 *  5. Business isolation: another business's token cannot see the patient.
 *
 * Run with:  node .tmp-patient-optional-test.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const pool = new pg.Pool({
  connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
});
const B = "http://localhost:3010/api";
const token = fs.readFileSync(".test-token.tmp", "utf8").trim();
const otherToken = JSON.parse(fs.readFileSync(".test-isolation.json", "utf8")).token;

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

const results = [];
const check = (name, cond, extra = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
};

let createdId = null;

try {
  // ---- 1) Only required fields; all three contact optionals blank ----
  let r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Optional Test Patient",
      gender: "Male",
      dateOfBirth: "1999-05-10",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
      // alternatePhone / email / fullAddress intentionally missing
    }),
  });
  createdId = r.json?.data?.id ?? null;
  check(
    "T1 required-only patient saves (optionals blank)",
    r.status === 201 && !!createdId,
    `status=${r.status} ${r.json?.message ?? ""}`
  );

  const d = r.json?.data ?? {};
  check("T2 alternate_phone stored as SQL NULL", d.alternate_phone === null, JSON.stringify(d.alternate_phone));
  check("T3 email stored as SQL NULL", d.email === null, JSON.stringify(d.email));
  check("T4 full_address stored as SQL NULL", d.full_address === null, JSON.stringify(d.full_address));
  check("T5 phone saved", d.phone === "+92 300 1112223", JSON.stringify(d.phone));
  check("T6 city saved", d.city === "Karachi", JSON.stringify(d.city));
  check(
    "T7 age derived from DOB server-side",
    d.age === 27 || (d.age >= 26 && d.age <= 27),
    JSON.stringify(d.age)
  );

  // ---- 2) Optional values provided -> stored normally ----
  r = await api(`/patients/${createdId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fullName: "Optional Test Patient",
      gender: "Male",
      dateOfBirth: "1999-05-10",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
      alternatePhone: "+92 301 7654321",
      email: "Test@Example.com",
      fullAddress: "  House 123, Block 5  ",
    }),
  });
  const u = r.json?.data ?? {};
  check("T8 PATCH with optionals succeeds", r.status === 200, `status=${r.status} ${r.json?.message ?? ""}`);
  check("T8a alternate phone saved", u.alternate_phone === "+92 301 7654321", JSON.stringify(u.alternate_phone));
  check("T8b email normalized (lowercase)", u.email === "test@example.com", JSON.stringify(u.email));
  check("T8c address trimmed", u.full_address === "House 123, Block 5", JSON.stringify(u.full_address));

  // ---- 3) Blank optionals again on PATCH -> back to NULL ----
  r = await api(`/patients/${createdId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fullName: "Optional Test Patient",
      gender: "Male",
      dateOfBirth: "1999-05-10",
      maritalStatus: "Single",
      phone: "+92 300 1112223",
      city: "Karachi",
      alternatePhone: "",
      email: "",
      fullAddress: "",
    }),
  });
  const b = r.json?.data ?? {};
  check("T9 PATCH blanks -> NULL again", r.status === 200 && b.alternate_phone === null && b.email === null && b.full_address === null, JSON.stringify({ a: b.alternate_phone, e: b.email, f: b.full_address }));

  // ---- 4) Required-field rejections still enforced ----
  r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "No Phone Patient",
      gender: "Male",
      dateOfBirth: "1990-01-01",
      maritalStatus: "Single",
      city: "Karachi",
      // phone missing
    }),
  });
  check(
    "T10 missing phone -> 400 with field error",
    r.status === 400 && r.json?.data?.errors?.phone === "Contact number is required.",
    JSON.stringify(r.json?.data?.errors ?? r.json?.message)
  );

  r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "No City Patient",
      gender: "Female",
      dateOfBirth: "1990-01-01",
      maritalStatus: "Single",
      phone: "+92 300 0000000",
      // city missing
    }),
  });
  check(
    "T11 missing city -> 400 with field error",
    r.status === 400 && r.json?.data?.errors?.city === "City is required.",
    JSON.stringify(r.json?.data?.errors ?? r.json?.message)
  );

  // ---- 5) Invalid provided optional -> still rejected ----
  r = await api("/patients", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Bad Email Patient",
      gender: "Female",
      dateOfBirth: "1990-01-01",
      maritalStatus: "Single",
      phone: "+92 300 0000000",
      city: "Karachi",
      email: "not-an-email",
    }),
  });
  check(
    "T12 invalid email (when provided) -> 400",
    r.status === 400 && typeof r.json?.data?.errors?.email === "string",
    JSON.stringify(r.json?.data?.errors ?? r.json?.message)
  );

  // ---- 6) Business isolation intact ----
  r = await api(`/patients/${createdId}`, {}, otherToken);
  check("T13 other business cannot read patient (404)", r.status === 404, `status=${r.status}`);

  // cleanup
  if (createdId) {
    await api(`/patients/${createdId}`, { method: "DELETE" });
  }
} finally {
  if (createdId) {
    await pool.query("DELETE FROM patient WHERE id = $1", [createdId]).catch(() => {});
  }
  await pool.end();
}

console.log(results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
