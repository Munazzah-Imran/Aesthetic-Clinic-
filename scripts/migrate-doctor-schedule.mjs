/**
 * One-time migration: doctor consultation schedule + per-doctor profiles.
 *
 * 1. `doctor`: adds the 7 consultation-schedule columns (NULLable).
 * 2. `doctor_profiles`: adds doctor_id UUID (one detailed profile per doctor),
 *    backfills one profile row per existing doctor, keeps the legacy
 *    business-level row until it is saved per-doctor.
 *
 * Run once with:  node scripts/migrate-doctor-schedule.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 1. schedule columns on doctor
  await client.query(`
    ALTER TABLE doctor
      ADD COLUMN IF NOT EXISTS consultation_days TEXT,
      ADD COLUMN IF NOT EXISTS consultation_start_time TIME,
      ADD COLUMN IF NOT EXISTS consultation_end_time TIME,
      ADD COLUMN IF NOT EXISTS max_patients_per_slot INTEGER,
      ADD COLUMN IF NOT EXISTS slot_duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS break_start_time TIME,
      ADD COLUMN IF NOT EXISTS break_end_time TIME`);

  // 2. per-doctor profiles
  await client.query(`
    ALTER TABLE doctor_profiles
      ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctor(id) ON DELETE CASCADE`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS doctor_profiles_doctor_id_key
      ON doctor_profiles (doctor_id) WHERE doctor_id IS NOT NULL`);

  // Backfill: one profile row per doctor (copied from the legacy business-level
  // row so existing data shows on the doctor's own profile).
  await client.query(`
    INSERT INTO doctor_profiles (business_id, doctor_id, full_name)
    SELECT d.business_id, d.id, d.full_name
    FROM doctor d
    WHERE NOT EXISTS (SELECT 1 FROM doctor_profiles dp WHERE dp.doctor_id = d.id)
    ON CONFLICT DO NOTHING`);

  await client.query("COMMIT");
  console.log("Migration complete.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
