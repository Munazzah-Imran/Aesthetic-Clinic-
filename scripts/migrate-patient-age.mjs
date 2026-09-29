/**
 * Adds the `age` column to the existing `patient` table.
 *
 * - Never creates or drops the patient table itself.
 * - The column is left NULLABLE at the database level on purpose: legacy rows
 *   (created before this change) must keep loading. The API/validation layer
 *   enforces age as REQUIRED for all new writes.
 * - Backfills age from date_of_birth for existing rows where possible.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Run with:  node scripts/migrate-patient-age.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const match = env.match(/^DATABASE_URL=(.*)$/m);
if (!match) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: match[1].trim(),
  ssl: match[1].includes("localhost") || match[1].includes("@db:") ? false : { rejectUnauthorized: false },
});

async function main() {
  // 1) Add the column if it does not exist yet.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient' AND column_name = 'age'
      ) THEN
        ALTER TABLE patient ADD COLUMN age INTEGER;
      END IF;
    END $$;
  `);

  // 2) Guard: sane values only (0..120), same rule as the validation layer.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'patient_age_range_check'
      ) THEN
        ALTER TABLE patient
          ADD CONSTRAINT patient_age_range_check CHECK (age IS NULL OR (age >= 0 AND age <= 120));
      END IF;
    END $$;
  `);

  // 3) Backfill existing rows from date_of_birth (won't touch non-null ages).
  await pool.query(`
    UPDATE patient
       SET age = (
             DATE_PART('year', CURRENT_DATE) - DATE_PART('year', date_of_birth)
           ) - CASE
                WHEN (DATE_PART('doy', CURRENT_DATE) < DATE_PART('doy', date_of_birth))
                THEN 1 ELSE 0
              END
     WHERE age IS NULL
       AND date_of_birth IS NOT NULL;
  `);

  const info = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(age)::int AS with_age
      FROM patient;
  `);
  console.log(
    `patient.age ready — ${info.rows[0].with_age}/${info.rows[0].total} rows have an age (backfilled from date_of_birth where possible).`
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
