/**
 * Server-only helpers for the `clinic_weekly_schedule` table.
 *
 * The table is linked to the EXISTING `clinic` table through `clinic_id`
 * (UUID FK, ON DELETE CASCADE) — clinics are never identified by name or
 * city. Business isolation always happens THROUGH the clinic join using the
 * business id resolved from the authenticated user.
 *
 * The schedule is SEDED FROM THE CLINIC RECORD itself:
 *   clinic.working_days + clinic.opening_time + clinic.closing_time
 * A day is Active only when it is listed in working_days AND the clinic has
 * both an opening and a closing time — hours are NEVER invented.
 *
 * Editing a day directly in the Weekly Schedule module wins from then on:
 * manually edited rows are detected via updated_at > created_at and are
 * never overwritten by later clinic edits.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import {
  buildWeeklySchedule,
  WEEKLY_DAYS,
  type WeeklyClinicSchedule,
  type WeeklyScheduleDay,
  type WeeklyScheduleRow,
} from "@/lib/weeklySchedule";

let tableEnsured = false;

/** The clinic fields a schedule is derived from. */
export type ClinicScheduleSource = {
  workingDays: string; // "Monday,Tuesday,..." (canonical order)
  openingTime: string | null; // "HH:MM" 24h, NULL when not provided
  closingTime: string | null; // "HH:MM" 24h, NULL when not provided
};

/**
 * Idempotent bootstrap for `clinic_weekly_schedule` (same philosophy as
 * scripts/db-init.ts: safe to run repeatedly, only creates what is missing).
 *
 * - Reuses the existing schedule table when it already exists (never a
 *   duplicate table, never a destructive change).
 * - FK: clinic_id -> clinic(id) ON DELETE CASCADE, so deleting a clinic can
 *   never leave orphaned schedule rows.
 */
export async function ensureClinicWeeklyScheduleTable(): Promise<void> {
  if (tableEnsured) return;

  const clinicTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic' LIMIT 1"
  );
  if ((clinicTable.rowCount ?? 0) === 0) {
    // The clinic table itself has not been bootstrapped yet — try again later.
    return;
  }

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

  tableEnsured = true;
}

/**
 * Derives the 7-day schedule from the clinic record — the SAME working days
 * and hours already shown on the Clinics module. Never invents hours: if
 * the clinic has no opening/closing time, every day stays Closed.
 */
export function deriveScheduleFromClinic(
  source: ClinicScheduleSource
): WeeklyScheduleDay[] {
  const selected = source.workingDays
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const opening = source.openingTime;
  const closing = source.closingTime;
  // "HH:MM" strings compare correctly in chronological order.
  const hasTimes = Boolean(opening && closing && opening < closing);

  return WEEKLY_DAYS.map((day) => {
    const active = hasTimes && selected.includes(day);
    return {
      day,
      is_open: active,
      opening_time: active ? opening : null,
      closing_time: active ? closing : null,
    };
  });
}

/**
 * Creates the schedule for a brand-new clinic from its own working days and
 * hours, so it appears in Weekly Schedule immediately with the right data.
 * Existing rows are never overwritten (ON CONFLICT DO NOTHING).
 */
export async function seedScheduleFromClinic(
  clinicId: string,
  source: ClinicScheduleSource
): Promise<void> {
  await ensureClinicWeeklyScheduleTable();
  if (!tableEnsured) return;

  const days = deriveScheduleFromClinic(source);
  const values: unknown[] = [clinicId];
  const tuples = days.map((d) => {
    const base = values.length + 1;
    values.push(d.day, d.is_open, d.opening_time, d.closing_time);
    return `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await pool.query(
    `INSERT INTO clinic_weekly_schedule
       (clinic_id, day_of_week, is_open, opening_time, closing_time)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (clinic_id, day_of_week) DO NOTHING`,
    values
  );
}

/**
 * Keeps the schedule in sync when the clinic's working days / hours change
 * in the Clinics module:
 *
 *   - days that were NEVER manually edited in Weekly Schedule are refreshed
 *     from the clinic record (and missing days are filled in);
 *   - days the admin already configured in Weekly Schedule are left exactly
 *     as they are (manual schedule edits always win).
 *
 * updated_at is intentionally NOT bumped on refresh: for these rows
 * updated_at = created_at is the marker for "still clinic-driven".
 */
export async function syncScheduleWithClinic(
  clinicId: string,
  source: ClinicScheduleSource
): Promise<void> {
  await ensureClinicWeeklyScheduleTable();
  if (!tableEnsured) return;

  const days = deriveScheduleFromClinic(source);
  const values: unknown[] = [clinicId];
  const tuples = days.map((d) => {
    const base = values.length + 1;
    values.push(d.day, d.is_open, d.opening_time, d.closing_time);
    return `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await pool.query(
    `INSERT INTO clinic_weekly_schedule
       (clinic_id, day_of_week, is_open, opening_time, closing_time)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (clinic_id, day_of_week)
     DO UPDATE SET is_open = EXCLUDED.is_open,
                   opening_time = EXCLUDED.opening_time,
                   closing_time = EXCLUDED.closing_time
     WHERE clinic_weekly_schedule.updated_at = clinic_weekly_schedule.created_at`,
    values
  );
}

/**
 * Loads every clinic of the authenticated business together with its own
 * 7-day schedule (Monday→Sunday, always in canonical order).
 *
 * Business isolation: WHERE c.business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 * Optionally narrowed to a single clinic (clinicId), still business-scoped.
 */
export async function loadWeeklySchedules(
  businessId: string,
  clinicId?: string
): Promise<WeeklyClinicSchedule[]> {
  await ensureClinicWeeklyScheduleTable();

  type JoinedRow = {
    clinic_id: string;
    clinic_name: string;
    city: string;
    clinic_status: string;
    day_of_week: string | null;
    is_open: boolean | null;
    opening_time: string | null;
    closing_time: string | null;
  };

  const result = await pool.query<JoinedRow>(
    `SELECT c.id AS clinic_id,
            c.clinic_name,
            c.city,
            c.status AS clinic_status,
            s.day_of_week,
            s.is_open,
            TO_CHAR(s.opening_time, 'HH24:MI') AS opening_time,
            TO_CHAR(s.closing_time, 'HH24:MI') AS closing_time
       FROM clinic c
       LEFT JOIN clinic_weekly_schedule s ON s.clinic_id = c.id
      WHERE c.business_id = $1
        AND ($2::uuid IS NULL OR c.id = $2)
      ORDER BY c.created_at ASC, c.clinic_name ASC`,
    [businessId, clinicId ?? null]
  );

  type Pending = {
    clinic: WeeklyClinicSchedule["clinic"];
    rows: WeeklyScheduleRow[];
  };
  const byClinic = new Map<string, Pending>();

  for (const row of result.rows) {
    let entry = byClinic.get(row.clinic_id);
    if (!entry) {
      entry = {
        clinic: {
          id: row.clinic_id,
          clinic_name: row.clinic_name,
          city: row.city,
          status: row.clinic_status,
        },
        rows: [],
      };
      byClinic.set(row.clinic_id, entry);
    }
    if (row.day_of_week) {
      entry.rows.push({
        day_of_week: row.day_of_week,
        is_open: row.is_open ?? false,
        opening_time: row.opening_time,
        closing_time: row.closing_time,
      });
    }
  }

  // Clinics without stored rows still appear, with an all-Closed fallback.
  return Array.from(byClinic.values()).map((entry) => ({
    clinic: entry.clinic,
    schedule: buildWeeklySchedule(entry.rows),
  }));
}
