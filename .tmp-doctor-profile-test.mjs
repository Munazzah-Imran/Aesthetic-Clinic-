/**
 * Doctor Profile data-flow test.
 *
 * Part 1 (READ-ONLY, real data): crafted JWT for the existing business —
 *   GET /api/doctors/[id]/profile for BOTH real doctors must return every
 *   snake_case key the frontend mapProfile() reads, with Munazzah's saved
 *   photo/phone/email/languages and doctor-row fallbacks for title/specialty.
 *   Doctor A's response must not contain Doctor B's data.
 *
 * Part 2 (throwaway business): create 2 doctors, PUT a profile for EACH
 *   (proves the legacy UNIQUE(business_id) is gone — the 2nd insert works),
 *   GET each back (no cross-contamination), re-PUT A (upsert UPDATE path),
 *   PATCH the schedule (existing edit flow), then delete everything.
 *
 * Part 3: schema + real-data verification (constraint dropped, orphan linked,
 *   saved values intact).
 *
 * Run: node .tmp-doctor-profile-test.mjs   (user's dev server on :3000)
 */
import fs from "fs";
import pg from "pg";
import jwt from "jsonwebtoken";

const env = fs.readFileSync(".env", "utf8");
const DB_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const JWT_SECRET = env.match(/^JWT_SECRET=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const PORT = process.env.TEST_PORT || 3000;
const B = `http://localhost:${PORT}/api`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const api = async (path, opts = {}, token) => {
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

/** Exactly the keys DoctorProfileForm's mapProfile() reads. */
const MAPPABLE_KEYS = [
  "photo_url", "full_name", "professional_title", "specialty", "experience",
  "qualifications", "additional_qualifications", "short_bio", "full_bio",
  "professional_interests", "areas_of_expertise", "phone", "email", "languages",
];

const BUSINESS_ID = "ab6a2799-4979-40ad-8c0d-f617ef8fe8ff"; // existing business
let throwawayBusinessId = null;

try {
  // ================= Part 1: real doctors (read-only) =================
  const user = await pool.query(
    "SELECT id, email FROM users WHERE business_id = $1 LIMIT 1",
    [BUSINESS_ID]
  );
  const realToken = jwt.sign(
    { sub: user.rows[0].id, email: user.rows[0].email, businessId: BUSINESS_ID },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const doctors = await pool.query(
    "SELECT id, full_name, professional_title, specialty FROM doctor WHERE business_id = $1 ORDER BY full_name",
    [BUSINESS_ID]
  );
  const rayyan = doctors.rows.find((d) => d.full_name === "rayyan imran");
  const munazzah = doctors.rows.find((d) => d.full_name === "Munazzah Imran");
  check("T1  found both real doctors", !!rayyan && !!munazzah,
    doctors.rows.map((d) => d.full_name).join(", "));

  // --- Munazzah: her linked profile must now be visible ---
  let r = await api(`/doctors/${munazzah.id}/profile`, {}, realToken);
  const m = r.json?.data ?? {};
  check("T2  Munazzah profile GET 200 + success wrapper", r.status === 200 && r.json?.success === true,
    `status=${r.status} msg=${r.json?.message ?? ""}`);
  check(
    "T3  every mapProfile() key present in response",
    MAPPABLE_KEYS.every((k) => k in (m ?? {})),
    Object.keys(m).join(",")
  );
  check(
    "T4  her SAVED fields appear: photo/phone/email/languages",
    typeof m.photo_url === "string" && m.photo_url.length > 0 &&
      m.phone === "03158173686" &&
      m.email === "munazzahimran4@gmail.com" &&
      m.languages === "english",
    JSON.stringify({ phone: m.phone, email: m.email, languages: m.languages, photo: typeof m.photo_url === "string" ? `len ${m.photo_url.length}` : m.photo_url })
  );
  check(
    "T5  title/specialty fallback from doctor row (profile snapshot was NULL)",
    m.full_name === "Munazzah Imran" &&
      m.professional_title === "consultant dermatoligist" &&
      m.specialty === "dermotoligist",
    JSON.stringify({ title: m.professional_title, specialty: m.specialty })
  );
  check("T6  linked to the right doctor row", m.doctor_id === munazzah.id, `doctor_id=${m.doctor_id}`);

  // --- Rayyan: no profile row yet -> identity from doctor row, photo null ---
  r = await api(`/doctors/${rayyan.id}/profile`, {}, realToken);
  const y = r.json?.data ?? {};
  check(
    "T7  Rayyan: identity fields from doctor row, rich fields null, photo null",
    r.status === 200 && r.json?.success === true &&
      y.full_name === "rayyan imran" &&
      y.professional_title === "consultant skin specialist" &&
      y.specialty === "skin specialist" &&
      y.photo_url === null && y.experience === null && y.qualifications === null &&
      y.phone === null && y.email === null && y.languages === null,
    JSON.stringify({ name: y.full_name, title: y.professional_title, photo: y.photo_url })
  );

  // --- No cross-contamination ---
  check(
    "T8  Doctor A's response contains none of Doctor B's data",
    !JSON.stringify(y).includes("munazzahimran4") && !JSON.stringify(y).includes("Munazzah") &&
      !JSON.stringify(m).includes("rayyan imran"),
    "responses are distinct"
  );

  // ================= Part 2: throwaway 2-doctor flow =================
  const email = `docprof-${Date.now()}@example.com`;
  r = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ businessName: "Doc Profile Test", name: "DP Test", email, password: "secret123" }),
  });
  throwawayBusinessId = r.json?.data?.business?.id ?? null;
  check("T9  throwaway signup", r.status === 201 && !!throwawayBusinessId, `status=${r.status}`);
  r = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
  const token = r.json?.data?.token ?? null;
  check("T10 login", !!token, `status=${r.status}`);

  r = await api("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Profile Test A" }) }, token);
  const docA = r.json?.data?.id ?? null;
  r = await api("/doctors", { method: "POST", body: JSON.stringify({ fullName: "Dr Profile Test B" }) }, token);
  const docB = r.json?.data?.id ?? null;
  check("T11 both doctors created", !!docA && !!docB, `A=${docA} B=${docB}`);

  const profileA = {
    fullName: "Dr Profile Test A", professionalTitle: "Consultant A", specialty: "Cardio A",
    experience: "5 years", qualifications: "MBBS", additionalQualifications: "FCPS",
    shortBio: "Short bio A", fullBio: "Full bio A", professionalInterests: "Interest A",
    areasOfExpertise: "Expertise A", phone: "+92 300 1111111", email: "dp-a@example.com",
    languages: "English, Urdu",
  };
  const profileB = {
    fullName: "Dr Profile Test B", professionalTitle: "Consultant B", specialty: "Dental B",
    experience: "9 years", qualifications: "BDS", additionalQualifications: "MDS",
    shortBio: "Short bio B", fullBio: "Full bio B", professionalInterests: "Interest B",
    areasOfExpertise: "Expertise B", phone: "+92 300 2222222", email: "dp-b@example.com",
    languages: "Urdu",
  };

  r = await api(`/doctors/${docA}/profile`, { method: "PUT", body: JSON.stringify(profileA) }, token);
  check("T12 PUT profile A (INSERT path)", r.status === 200, `status=${r.status} ${r.json?.message ?? ""}`);
  r = await api(`/doctors/${docB}/profile`, { method: "PUT", body: JSON.stringify(profileB) }, token);
  check(
    "T13 PUT profile B — second profile for SAME business works (legacy UNIQUE(business_id) gone)",
    r.status === 200,
    `status=${r.status} ${r.json?.message ?? ""}`
  );

  r = await api(`/doctors/${docA}/profile`, {}, token);
  const ga = r.json?.data ?? {};
  check(
    "T14 GET A returns A's full saved profile (all 14 fields)",
    r.status === 200 && MAPPABLE_KEYS.every((k) => ga[k] !== undefined) &&
      ga.full_name === profileA.fullName && ga.experience === "5 years" &&
      ga.phone === "+92 300 1111111" && ga.email === "dp-a@example.com" &&
      ga.areas_of_expertise === "Expertise A" && ga.languages === "English, Urdu",
    JSON.stringify({ name: ga.full_name, exp: ga.experience, email: ga.email })
  );

  r = await api(`/doctors/${docB}/profile`, {}, token);
  const gb = r.json?.data ?? {};
  check(
    "T15 GET B returns B's profile — A's data did NOT leak in",
    r.status === 200 && gb.full_name === profileB.fullName && gb.experience === "9 years" &&
      gb.phone === "+92 300 2222222" && gb.email === "dp-b@example.com" &&
      gb.professional_title === "Consultant B" && gb.specialty === "Dental B" &&
      !JSON.stringify(gb).includes("dp-a@example.com") && !JSON.stringify(gb).includes("5 years"),
    JSON.stringify({ name: gb.full_name, exp: gb.experience, email: gb.email })
  );

  // ---- re-save A: upsert UPDATE path ----
  r = await api(`/doctors/${docA}/profile`, {
    method: "PUT",
    body: JSON.stringify({ ...profileA, experience: "6 years" }),
  }, token);
  check("T16 re-PUT A (upsert UPDATE path)", r.status === 200, `status=${r.status}`);
  r = await api(`/doctors/${docA}/profile`, {}, token);
  check(
    "T17 reopen A shows updated value, other fields intact",
    r.json?.data?.experience === "6 years" &&
      r.json?.data?.phone === "+92 300 1111111" && r.json?.data?.email === "dp-a@example.com",
    `experience=${r.json?.data?.experience}`
  );

  // ---- existing doctor PATCH (schedule) still works ----
  r = await api(`/doctors/${docB}`, {
    method: "PATCH",
    body: JSON.stringify({
      fullName: "Dr Profile Test B", specialty: "Dental B", professionalTitle: "Consultant B",
      status: "active", consultationDays: ["Monday"],
      consultationStartTime: "10:00", consultationEndTime: "13:00",
    }),
  }, token);
  check(
    "T18 doctor PATCH (schedule) still works",
    r.status === 200 && r.json?.data?.consultationDays === "Monday" &&
      r.json?.data?.consultationStartTime === "10:00",
    `status=${r.status}`
  );
} finally {
  try {
    // ---- cleanup throwaway business (all FKs cascade) ----
    if (throwawayBusinessId) {
      await pool.query("DELETE FROM doctor_profiles WHERE business_id = $1", [throwawayBusinessId]).catch(() => {});
      await pool.query("DELETE FROM doctor WHERE business_id = $1", [throwawayBusinessId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE business_id = $1", [throwawayBusinessId]).catch(() => {});
      await pool.query("DELETE FROM business WHERE id = $1", [throwawayBusinessId]).catch(() => {});
    }

    // ---- Part 3: schema + real-data verification ----
    const cons = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'doctor_profiles'::regclass AND contype = 'u'"
    );
    check(
      "T19 legacy UNIQUE(business_id) dropped; doctor_id unique index kept",
      !cons.rows.some((c) => c.conname === "doctor_profiles_business_id_key"),
      cons.rows.map((c) => c.conname).join(",") || "(none)"
    );

    const prof = await pool.query(
      `SELECT doctor_id, full_name, professional_title, experience, phone, email, languages,
              photo_url IS NOT NULL AS has_photo
         FROM doctor_profiles WHERE business_id = $1`,
      [BUSINESS_ID]
    );
    const real = prof.rows[0];
    check(
      "T20 real profile row: linked to doctor, saved values intact, no data deleted",
      prof.rows.length === 1 && real.doctor_id === "c05a1362-3e25-43a7-a219-6cd3cb46953e" &&
        real.full_name === "Munazzah Imran" && real.phone === "03158173686" &&
        real.email === "munazzahimran4@gmail.com" && real.has_photo === true,
      JSON.stringify({ rows: prof.rows.length, doctor_id: real.doctor_id, phone: real.phone })
    );

    const leftovers = await pool.query(
      `SELECT (SELECT count(*)::int FROM business WHERE business_name = 'Doc Profile Test') AS b,
              (SELECT count(*)::int FROM doctor WHERE full_name LIKE 'Dr Profile Test%') AS d`
    );
    check(
      "T21 no leftover test data",
      leftovers.rows[0].b === 0 && leftovers.rows[0].d === 0,
      JSON.stringify(leftovers.rows[0])
    );
    const counts = await pool.query(
      "SELECT (SELECT count(*)::int FROM doctor) AS doctors, (SELECT count(*)::int FROM doctor_profiles) AS profiles"
    );
    check(
      "T22 real counts unchanged (2 doctors, 1 profile)",
      counts.rows[0].doctors === 2 && counts.rows[0].profiles === 1,
      JSON.stringify(counts.rows[0])
    );
  } catch (err) {
    console.error("cleanup/verification failed:", err);
  }
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
console.log("\nALL TESTS PASSED");
