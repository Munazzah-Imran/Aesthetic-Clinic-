/**
 * Off-Days module: per-clinic off-days (holidays / closed dates).
 *
 * - Creates `clinic_off_day` (only if it does not exist yet) and links it to
 *   the EXISTING `clinic` table through:
 *
 *       clinic_id UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE
 *
 *   so deleting a clinic never leaves orphaned off-days. No clinic data and
 *   no existing data is ever deleted or modified.
 *
 * - One off-day = one single date per clinic (UNIQUE clinic_id + off_date).
 *   The same date can be an off-day for any number of clinics.
 *
 * - Never creates a duplicate clinic or off-day table: if the table already
 *   exists it is reused as-is.
 *
 * - No default rows are invented: off-days are always explicit entries made
 *   by the admin.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Run with:  node scripts/migrate-clinic-off-day.mjs
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

  // 1) Create the off-day table (reuse it when it already exists).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinic_off_day (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id   UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE,
      off_date    DATE NOT NULL,
      reason      VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinic_off_day_unique UNIQUE (clinic_id, off_date)
    )
  `);

  const info = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM clinic) AS clinics,
      (SELECT COUNT(*)::int FROM clinic_off_day) AS off_days
  `);
  const { clinics, off_days } = info.rows[0];
  console.log(
    `clinic_off_day ready — ${off_days} off-day(s) across ${clinics} clinic(s).`
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
