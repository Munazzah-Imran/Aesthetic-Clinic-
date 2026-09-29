/**
 * One-time migration: multi-doctor support.
 *
 * 1. Creates the new `doctor` table (one row per doctor, per business).
 * 2. Copies existing `doctor_profiles` rows into `doctor` (existing data preserved).
 * 3. Repoints the `appointment.doctor_id` FK from doctor_profiles to doctor.
 *
 * Run once with:  node scripts/migrate-multi-doctor.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 1. doctor table (one row per doctor)
  await client.query(`
    CREATE TABLE IF NOT EXISTS doctor (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
      full_name VARCHAR(255) NOT NULL,
      specialty VARCHAR(255),
      professional_title VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT doctor_business_id_full_name_key UNIQUE (business_id, full_name)
    )`);

  // 2. copy existing profile rows into doctor (keeps the current doctor's data)
  await client.query(`
    INSERT INTO doctor (business_id, full_name, specialty, professional_title)
    SELECT business_id, full_name, specialty, professional_title
    FROM doctor_profiles
    ON CONFLICT (business_id, full_name) DO NOTHING`);

  // 3. repoint appointment.doctor_id: drop old FK, backfill from profiles, add new FK
  const fk = await client.query(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'appointment'
      AND constraint_name = 'appointment_doctor_id_fkey'`);
  if (fk.rowCount > 0) {
    await client.query("ALTER TABLE appointment DROP CONSTRAINT appointment_doctor_id_fkey");
  }
  await client.query(`
    UPDATE appointment a
    SET doctor_id = d.id
    FROM doctor_profiles dp
    JOIN doctor d ON d.business_id = dp.business_id AND d.full_name = dp.full_name
    WHERE a.doctor_id = dp.id`);
  await client.query(`
    ALTER TABLE appointment
    ADD CONSTRAINT appointment_doctor_id_fkey
    FOREIGN KEY (doctor_id) REFERENCES doctor(id) ON DELETE CASCADE`);

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
