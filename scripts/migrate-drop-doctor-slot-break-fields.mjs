/**
 * One-time migration: remove unused consultation slot/break fields.
 *
 * Drops the 4 columns from the `doctor` table that belonged to the removed
 * "slot duration / max patients / break time" form fields:
 *   - slot_duration_minutes
 *   - max_patients_per_slot
 *   - break_start_time
 *   - break_end_time
 *
 * Consultation days and start/end time stay. No other tables are touched.
 * Safe to re-run: uses DROP COLUMN IF EXISTS.
 *
 * Run once with:  node scripts/migrate-drop-doctor-slot-break-fields.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query("BEGIN");

  await client.query(`
    ALTER TABLE doctor
      DROP COLUMN IF EXISTS slot_duration_minutes,
      DROP COLUMN IF EXISTS max_patients_per_slot,
      DROP COLUMN IF EXISTS break_start_time,
      DROP COLUMN IF EXISTS break_end_time`);

  await client.query("COMMIT");
  console.log("Migration complete: slot/break columns dropped from doctor table.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
