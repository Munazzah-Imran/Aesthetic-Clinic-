/**
 * Connects the Clinics module with the Weekly Schedule module.
 *
 * - Creates `clinic_weekly_schedule` (only if it does not exist yet) and
 *   links it to the EXISTING `clinic` table through:
 *
 *       clinic_id UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE
 *
 *   so deleting a clinic never leaves orphaned schedules. No clinic data and
 *   no existing schedule data is ever deleted or modified.
 *
 * - Never creates a duplicate clinic or schedule table: if the schedule
 *   table already exists it is reused as-is.
 *
 * - Backfills each clinic's schedule from its OWN clinic record
 *   (working_days + opening_time + closing_time) — only for days that were
 *   never manually edited in the Weekly Schedule module. Working hours are
 *   never invented, and custom schedule rows are never overwritten.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Run with:  node scripts/migrate-clinic-weekly-schedule.mjs
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

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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

  // 1) Create the schedule table (reuse it when it already exists).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinic_weekly_schedule (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id     UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE,
      day_of_week   VARCHAR(20) NOT NULL,
      is_open       BOOLEAN NOT NULL DEFAULT FALSE,
      opening_time  TIME,
      closing_time  TIME,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinic_weekly_schedule_day_check
        CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
      CONSTRAINT clinic_weekly_schedule_times_check
        CHECK (is_open = FALSE OR (opening_time IS NOT NULL AND closing_time IS NOT NULL)),
      CONSTRAINT clinic_weekly_schedule_clinic_day_key UNIQUE (clinic_id, day_of_week)
    )
  `);

  // 2) Safety net for legacy installs: add clinic_id + FK if the table
  //    somehow pre-existed without the relationship (pure no-ops otherwise).
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clinic_weekly_schedule' AND column_name = 'clinic_id'
      ) THEN
        ALTER TABLE clinic_weekly_schedule ADD COLUMN clinic_id UUID;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'clinic_weekly_schedule_clinic_id_fkey'
      ) THEN
        ALTER TABLE clinic_weekly_schedule
          ADD CONSTRAINT clinic_weekly_schedule_clinic_id_fkey
          FOREIGN KEY (clinic_id) REFERENCES clinic(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // 3) Backfill every clinic's schedule FROM THE CLINIC RECORD itself:
  //    working_days decides which days are Active, opening_time/closing_time
  //    provide the hours (no invented hours — without times a day is Closed).
  //    Existing rows are only refreshed when they were never manually edited
  //    in the Weekly Schedule module (updated_at = created_at), so custom
  //    schedules are always preserved and this stays idempotent.
  await pool.query(`
    INSERT INTO clinic_weekly_schedule (clinic_id, day_of_week, is_open, opening_time, closing_time)
    SELECT x.clinic_id,
           x.day_of_week,
           x.is_open,
           CASE WHEN x.is_open THEN x.opening_time END,
           CASE WHEN x.is_open THEN x.closing_time END
      FROM (
        SELECT c.id AS clinic_id,
               d.day AS day_of_week,
               (d.day = ANY(ARRAY(
                   SELECT TRIM(t) FROM unnest(string_to_array(c.working_days, ',')) AS t
                 ))
                AND c.opening_time IS NOT NULL
                AND c.closing_time IS NOT NULL
                AND c.opening_time < c.closing_time) AS is_open,
               c.opening_time,
               c.closing_time
          FROM clinic c
          CROSS JOIN (VALUES
            ('Monday'),('Tuesday'),('Wednesday'),('Thursday'),
            ('Friday'),('Saturday'),('Sunday')
          ) AS d(day)
      ) x
    ON CONFLICT (clinic_id, day_of_week)
    DO UPDATE SET is_open = EXCLUDED.is_open,
                  opening_time = EXCLUDED.opening_time,
                  closing_time = EXCLUDED.closing_time
     WHERE clinic_weekly_schedule.updated_at = clinic_weekly_schedule.created_at
  `);

  const info = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM clinic) AS clinics,
      (SELECT COUNT(DISTINCT clinic_id)::int FROM clinic_weekly_schedule) AS with_schedule,
      (SELECT COUNT(*)::int FROM clinic_weekly_schedule) AS rows
  `);
  const { clinics, with_schedule, rows } = info.rows[0];
  console.log(
    `clinic_weekly_schedule ready — ${with_schedule}/${clinics} clinics have a schedule (${rows} day rows).`
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
