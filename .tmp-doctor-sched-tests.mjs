import fs from "fs";
import pg from "pg";
const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const B = "http://localhost:3001/api";
const token = fs.readFileSync(".test-token.tmp", "utf8").trim();
const otherToken = JSON.parse(fs.readFileSync(".test-isolation.json", "utf8")).token;
const BID = "ab6a2799-4979-40ad-8c0d-f617ef8fe8ff";

const api = async (path, opts = {}, tok = token) => {
  const res = await fetch(B + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

const results = [];
const check = (name, cond, extra = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
};

// Start clean for this business's test doctors
await pool.query("DELETE FROM doctor WHERE business_id = $1 AND full_name LIKE 'Dr. Test%'", [BID]);

try {
  // TEST 1: Create Doctor A with schedule
  let r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Dr. Test Ayesha", specialty: "Dermatology", professionalTitle: "Consultant", status: "active",
      consultationDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      consultationStartTime: "10:00", consultationEndTime: "14:00",
      slotDurationMinutes: "30", maxPatientsPerSlot: "5",
      breakStartTime: "12:00", breakEndTime: "12:30",
    }),
  });
  const A = r.json?.data;
  check("T1 create Doctor A", r.status === 201 && !!A, r.json?.message ?? "");
  check("T1 A schedule saved", A?.consultationDays === "Monday,Tuesday,Wednesday,Thursday,Friday" && A?.consultationStartTime === "10:00" && A?.slotDurationMinutes === 30 && A?.maxPatientsPerSlot === 5, JSON.stringify(A?.consultationDays));
  check("T1 A break saved", A?.breakStartTime === "12:00" && A?.breakEndTime === "12:30", `${A?.breakStartTime}-${A?.breakEndTime}`);

  // TEST 2: Create Doctor B (different info) — simulates fresh Add Doctor
  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Dr. Test Bilal", specialty: "Cardiology",
      consultationDays: ["Saturday"], consultationStartTime: "09:00", consultationEndTime: "11:00",
      slotDurationMinutes: "15", maxPatientsPerSlot: "2",
    }),
  });
  const Bdoc = r.json?.data;
  check("T2 create Doctor B", r.status === 201 && !!Bdoc, r.json?.message ?? "");
  check("T2 B has NO A's schedule", Bdoc?.consultationDays === "Saturday" && Bdoc?.consultationStartTime === "09:00" && Bdoc?.slotDurationMinutes === 15 && Bdoc?.maxPatientsPerSlot === 2 && Bdoc?.breakStartTime === null, JSON.stringify({ d: Bdoc?.consultationDays, b: Bdoc?.breakStartTime }));

  // TEST 3: Edit A -> only A changes
  r = await api(`/doctors/${A.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      fullName: "Dr. Test Ayesha", specialty: "Aesthetic Dermatology",
      consultationDays: ["Monday", "Wednesday"], consultationStartTime: "11:00", consultationEndTime: "15:00",
      slotDurationMinutes: "20", maxPatientsPerSlot: "3",
    }),
  });
  check("T3 PATCH A", r.status === 200 && r.json?.data?.consultationStartTime === "11:00" && r.json?.data?.slotDurationMinutes === 20, r.json?.message ?? "");

  // B unchanged
  r = await api(`/doctors/${Bdoc.id}`);
  const bAfter = r.json?.data;
  check("T3 B unchanged after A edit", bAfter?.consultationDays === "Saturday" && bAfter?.consultationStartTime === "09:00", `${bAfter?.consultationDays} ${bAfter?.consultationStartTime}`);

  // TEST 4: per-doctor profiles never leak (the reported stale-data bug, API level)
  r = await api(`/doctors/${A.id}/profile`, {
    method: "PUT",
    body: JSON.stringify({ fullName: "Dr. Test Ayesha", specialty: "Aesthetic Dermatology", experience: "10+ Years", qualifications: "MBBS, FCPS", email: "a@test.com" }),
  });
  check("T4 save profile A", r.status === 200 && r.json?.data?.doctor_id === A.id, r.json?.message ?? "");

  r = await api(`/doctors/${Bdoc.id}/profile`);
  const profB = r.json?.data;
  check("T4 profile B does NOT leak A's data", r.status === 200 && profB !== null && profB.full_name === "Dr. Test Bilal" && profB.experience === null && profB.email !== "a@test.com", JSON.stringify({ n: profB?.full_name, e: profB?.experience, em: profB?.email }));

  r = await api(`/doctors/${Bdoc.id}/profile`, {
    method: "PUT",
    body: JSON.stringify({ fullName: "Dr. Test Bilal", specialty: "Cardiology", experience: "5+ Years" }),
  });
  check("T4 save profile B", r.status === 200, r.json?.message ?? "");

  r = await api(`/doctors/${A.id}/profile`);
  check("T4 profile A intact after B save", r.json?.data?.experience === "10+ Years" && r.json?.data?.email === "a@test.com", JSON.stringify({ e: r.json?.data?.experience }));

  // TEST 5: validation rules
  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr. Test X", consultationStartTime: "10:00", consultationEndTime: "09:00" }),
  });
  check("T5 end<=start 400", r.status === 400, JSON.stringify(r.json?.data?.errors ?? r.json?.message));

  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr. Test X", consultationDays: ["Monday"], consultationStartTime: "10:00", consultationEndTime: "12:00", breakStartTime: "09:30", breakEndTime: "09:45" }),
  });
  check("T5 break outside hours 400", r.status === 400, JSON.stringify(r.json?.data?.errors ?? r.json?.message));

  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr. Test X", consultationDays: ["Monday"], consultationStartTime: "10:00", consultationEndTime: "12:00", breakStartTime: "10:30" }),
  });
  check("T5 one-sided break 400", r.status === 400, JSON.stringify(r.json?.data?.errors ?? r.json?.message));

  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr. Test X", consultationDays: ["Monday"], consultationStartTime: "10:00", consultationEndTime: "12:00", maxPatientsPerSlot: "0" }),
  });
  check("T5 max patients 0 -> 400", r.status === 400, JSON.stringify(r.json?.data?.errors ?? r.json?.message));

  r = await api("/doctors", {
    method: "POST",
    body: JSON.stringify({ fullName: "Dr. Test X", consultationDays: ["Monday"], consultationStartTime: "10:00", consultationEndTime: "12:00", slotDurationMinutes: "25" }),
  });
  check("T5 invalid slot 25 -> 400", r.status === 400, JSON.stringify(r.json?.data?.errors ?? r.json?.message));

  // TEST 6: isolation on per-doctor profile
  r = await api(`/doctors/${A.id}/profile`, {}, otherToken);
  check("T6 isolation profile GET 404", r.status === 404, String(r.status));
  r = await api(`/doctors/${A.id}/profile`, { method: "PUT", body: JSON.stringify({ fullName: "Hacker" }) }, otherToken);
  check("T6 isolation profile PUT 404", r.status === 404, String(r.status));

  // TEST 7: GET single returns only that doctor (per spec WHERE id AND business_id)
  r = await api(`/doctors/${A.id}`, {}, otherToken);
  check("T7 other business GET doctor 404", r.status === 404, String(r.status));

  // cleanup
  await api(`/doctors/${A.id}`, { method: "DELETE" });
  await api(`/doctors/${Bdoc.id}`, { method: "DELETE" });
} finally {
  await pool.query("DELETE FROM doctor WHERE business_id = $1 AND full_name LIKE 'Dr. Test%'", [BID]);
  await pool.end();
}
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
