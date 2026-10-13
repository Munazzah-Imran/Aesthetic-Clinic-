/**
 * Regression guard for src/lib/idSequences.ts:
 *
 * The RPT prefix points at `uploaded_report`, which is created LAZILY by the
 * reports module. On a database where that table has never existed,
 * ensureIdSequences must still succeed (skipping only the RPT fast-forward)
 * so PATIENT and APPOINTMENT ID generation can never break.
 *
 * Runs against the LOCAL Docker Postgres (never the real database).
 *
 * Run: node --experimental-strip-types .tmp-idseq-guard-test.ts
 */
import pool from "./src/lib/db.ts";
import { ensureIdSequences, ID_SEQUENCE_CONFIG } from "./src/lib/idSequences.ts";

const results: string[] = [];
const check = (name: string, cond: boolean, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // Minimal schema: patient + appointment exist, uploaded_report does NOT.
  await client.query(
    "DROP TABLE IF EXISTS uploaded_report CASCADE"
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS patient (id UUID PRIMARY KEY, patient_id VARCHAR(50) UNIQUE)`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS appointment (id UUID PRIMARY KEY, appointment_id VARCHAR(50) UNIQUE)`
  );

  const before = await client.query(
    "SELECT to_regclass('uploaded_report') AS t"
  );
  check("uploaded_report does NOT exist yet", before.rows[0].t === null, `got=${before.rows[0].t}`);

  // THE POINT: must not throw 42P01 (relation does not exist).
  let threw: unknown = null;
  try {
    await ensureIdSequences(client);
  } catch (err) {
    threw = err;
  }
  check(
    "ensureIdSequences succeeds WITHOUT uploaded_report (patient/apt IDs keep working)",
    threw === null,
    String((threw as Error)?.message ?? threw ?? "")
  );

  const seqs = await client.query(
    `SELECT sequence_name FROM information_schema.sequences
      WHERE sequence_schema = 'public' ORDER BY sequence_name`
  );
  const names = seqs.rows.map((r) => r.sequence_name);
  check(
    "all five sequences created (PT/APT/RPT/VC/ALR — config-driven)",
    [
      "appointment_id_sequence",
      "patient_id_sequence",
      "report_id_sequence",
      "virtual_consultation_id_sequence",
      "emergency_alert_id_sequence",
    ].every((s) => names.includes(s)),
    names.join(",")
  );

  const cfg = ID_SEQUENCE_CONFIG;
  check(
    "config table names are the real ones",
    cfg.PT.table === "patient" && cfg.APT.table === "appointment" &&
      cfg.RPT.table === "uploaded_report" && cfg.RPT.sequence === "report_id_sequence" &&
      cfg.VC.table === "virtual_consultation" && cfg.VC.sequence === "virtual_consultation_id_sequence" &&
      cfg.ALR.table === "emergency_alert" && cfg.ALR.sequence === "emergency_alert_id_sequence"
  );

  // Second phase: now simulate the reports module creating its table with a
  // pre-existing RPT id — the fast-forward must skip past it (forward-only).
  await client.query(`
    CREATE TABLE IF NOT EXISTS uploaded_report (
      id UUID PRIMARY KEY,
      business_id UUID,
      report_id VARCHAR(50) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    "INSERT INTO uploaded_report (id, business_id, report_id) VALUES (gen_random_uuid(), gen_random_uuid(), $1)",
    [`RPT-20991231-0042`]
  );
  await ensureIdSequences(client);
  check(
    "fast-forward runs once the table exists",
    true
  );

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  check("UNEXPECTED ERROR", false, String((err as Error)?.message ?? err));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

console.log("\n" + results.join("\n"));
if (results.some((l) => l.startsWith("FAIL"))) process.exit(1);
console.log("\nGUARD TEST PASSED");
