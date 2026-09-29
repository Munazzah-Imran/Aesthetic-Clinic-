/**
 * Server-only helpers for the `clinic_special_schedule` table.
 *
 * The table is linked to the EXISTING `clinic` table through `clinic_id`
 * (UUID FK, ON DELETE CASCADE) — clinics are never identified by name or
 * city. Business isolation always happens THROUGH the clinic join using the
 * business id resolved from the authenticated user.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import type {
  ClinicSpecialSchedule,
  ClinicSpecialsItem,
} from "@/lib/specialSchedules";

let tableEnsured = false;

/**
 * Idempotent bootstrap for `clinic_special_schedule` (same philosophy as
 * scripts/db-init.ts: safe to run repeatedly, only creates what is missing).
 *
 * - Reuses an existing table when present (never a duplicate table).
 * - FK: clinic_id -> clinic(id) ON DELETE CASCADE, so deleting a clinic can
 *   never leave orphaned special schedules.
 */
export async function ensureClinicSpecialScheduleTable(): Promise<void> {
  if (tableEnsured) return;

  const clinicTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic' LIMIT 1"
  );
  if ((clinicTable.rowCount ?? 0) === 0) {
    // The clinic table itself has not been bootstrapped yet — try again later.
    return;
  }

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

  tableEnsured = true;
}

/**
 * Loads every clinic of the authenticated business together with its
 * special schedules (so each clinic always has a card, even with zero
 * entries).
 *
 * Business isolation: WHERE c.business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 */
export async function loadSpecialSchedulesByClinic(
  businessId: string
): Promise<ClinicSpecialsItem[]> {
  await ensureClinicSpecialScheduleTable();

  type JoinedRow = {
    clinic_id: string;
    clinic_name: string;
    city: string;
    clinic_status: string;
    special_id: string | null;
    special_date: string | null;
    opening_time: string | null;
    closing_time: string | null;
    reason: string | null;
  };

  const result = await pool.query<JoinedRow>(
    `SELECT c.id AS clinic_id,
            c.clinic_name,
            c.city,
            c.status AS clinic_status,
            s.id AS special_id,
            TO_CHAR(s.special_date, 'YYYY-MM-DD') AS special_date,
            TO_CHAR(s.opening_time, 'HH24:MI') AS opening_time,
            TO_CHAR(s.closing_time, 'HH24:MI') AS closing_time,
            s.reason
       FROM clinic c
       LEFT JOIN clinic_special_schedule s ON s.clinic_id = c.id
      WHERE c.business_id = $1
      ORDER BY c.created_at ASC, c.clinic_name ASC, s.special_date ASC`,
    [businessId]
  );

  type Pending = {
    clinic: ClinicSpecialsItem["clinic"];
    specials: ClinicSpecialSchedule[];
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
        specials: [],
      };
      byClinic.set(row.clinic_id, entry);
    }
    if (row.special_id && row.special_date && row.opening_time && row.closing_time) {
      entry.specials.push({
        id: row.special_id,
        clinic_id: row.clinic_id,
        special_date: row.special_date,
        opening_time: row.opening_time,
        closing_time: row.closing_time,
        reason: row.reason,
      });
    }
  }

  return Array.from(byClinic.values());
}

/**
 * Returns true when the clinic already has an OFF-DAY (closed date) on this
 * date. A date can never be both closed and a special-hours override for
 * the same clinic — the two modules stay contradictory-free.
 */
export async function hasOffDayOn(
  clinicId: string,
  date: string
): Promise<boolean> {
  // The off-day table is bootstrapped by its own module; query through the
  // shared ensure so a fresh environment without it never errors.
  const table = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic_off_day' LIMIT 1"
  );
  if ((table.rowCount ?? 0) === 0) return false;

  const result = await pool.query(
    "SELECT 1 FROM clinic_off_day WHERE clinic_id = $1 AND off_date = $2::date LIMIT 1",
    [clinicId, date]
  );
  return (result.rowCount ?? 0) > 0;
}
