/**
 * One-time migration: Doctor Profile "Branch (City)" dropdown.
 *
 * Adds `doctor_profiles.clinic_id` — a NULLable reference to the existing
 * `clinic` table (the business's branches, each with a city). Nullable so
 * every existing profile keeps loading; ON DELETE SET NULL so deleting a
 * branch never deletes a doctor profile. No new tables.
 *
 * Run once with:  node scripts/migrate-doctor-branch.mjs
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
    ALTER TABLE doctor_profiles
      ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinic(id) ON DELETE SET NULL`);

  await client.query(
    `CREATE INDEX IF NOT EXISTS doctor_profiles_clinic_id_idx
       ON doctor_profiles (clinic_id) WHERE clinic_id IS NOT NULL`
  );

  await client.query("COMMIT");
  console.log("doctor_profiles.clinic_id is ready.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed, rolled back:", err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
