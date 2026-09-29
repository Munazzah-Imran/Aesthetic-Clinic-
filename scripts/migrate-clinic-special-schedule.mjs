/**
 * Special Schedules module: per-clinic one-off schedule overrides.
 *
 * - Creates `clinic_special_schedule` (only if it does not exist yet) and
 *   links it to the EXISTING `clinic` table through:
 *
 *       clinic_id UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE
 *
 *   so deleting a clinic never leaves orphaned special schedules. No clinic
 *   data and no existing data is ever deleted or modified.
 *
 * - One special schedule = one single date on which the clinic opens with
 *   DIFFERENT hours than its Weekly Schedule (UNIQUE clinic_id + special_date).
 *   A fully closed date is an OFF-DAY, not a special schedule — the two can
 *   never exist for the same clinic + date (enforced by the API).
 *
 * - Never creates a duplicate table: if the table already exists it is
 *   reused as-is. No default rows are invented.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Run with:  node scripts/migrate-clinic-special-schedule.mjs
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
  ssl: match[1].includes("localhost") || match[1].includes("@db:")
    ? false
    : { rejectUnauthorized: false },
});

async function main() {
  // 0) Guard: the EXISTING clinic table must be present (never recreated).
  const clinicTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic' LIMIT 1"
  );
  if ((clinicTable.rowCount ?? 0) === 0) {
    console.error(
      "The existing `clinic` table was not found — nothing to link to. Aborting."
    );
    process.exit(1);
  }

  // 1) Create the special-schedule table (reuse it when it already exists).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinic_special_schedule (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id     UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE,
      special_date  DATE NOT NULL,
      opening_time  TIME NOT NULL,
      closing_time  TIME NOT NULL,
      reason        VARCHAR(255),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinic_special_schedule_unique UNIQUE (clinic_id, special_date),
      CONSTRAINT clinic_special_schedule_times_check CHECK (closing_time > opening_time)
    )
  `);

  const info = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM clinic) AS clinics,
      (SELECT COUNT(*)::int FROM clinic_special_schedule) AS specials
  `);
  const { clinics, specials } = info.rows[0];
  console.log(
    `clinic_special_schedule ready — ${specials} special schedule(s) across ${clinics} clinic(s).`
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
