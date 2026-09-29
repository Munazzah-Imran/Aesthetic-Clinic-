/**
 * Server-only helpers for the `clinic_off_day` table.
 *
 * The table is linked to the EXISTING `clinic` table through `clinic_id`
 * (UUID FK, ON DELETE CASCADE) — clinics are never identified by name or
 * city. Business isolation always happens THROUGH the clinic join using the
 * business id resolved from the authenticated user.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import type { ClinicOffDaysItem, ClinicOffDay } from "@/lib/offDays";

let tableEnsured = false;

/**
 * Idempotent bootstrap for `clinic_off_day` (same philosophy as
 * scripts/db-init.ts: safe to run repeatedly, only creates what is missing).
 *
 * - Reuses an existing off-day table when present (never a duplicate table).
 * - FK: clinic_id -> clinic(id) ON DELETE CASCADE, so deleting a clinic can
 *   never leave orphaned off-days.
 */
export async function ensureClinicOffDayTable(): Promise<void> {
  if (tableEnsured) return;

  const clinicTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic' LIMIT 1"
  );
  if ((clinicTable.rowCount ?? 0) === 0) {
    // The clinic table itself has not been bootstrapped yet — try again later.
    return;
  }

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

  tableEnsured = true;
}

/**
 * Loads every clinic of the authenticated business together with its
 * off-days (so each clinic always has a card, even with zero entries).
 *
 * Business isolation: WHERE c.business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 */
export async function loadOffDaysByClinic(
  businessId: string
): Promise<ClinicOffDaysItem[]> {
  await ensureClinicOffDayTable();

  type JoinedRow = {
    clinic_id: string;
    clinic_name: string;
    city: string;
    clinic_status: string;
    off_id: string | null;
    off_date: string | null;
    reason: string | null;
  };

  const result = await pool.query<JoinedRow>(
    `SELECT c.id AS clinic_id,
            c.clinic_name,
            c.city,
            c.status AS clinic_status,
            o.id AS off_id,
            TO_CHAR(o.off_date, 'YYYY-MM-DD') AS off_date,
            o.reason
       FROM clinic c
       LEFT JOIN clinic_off_day o ON o.clinic_id = c.id
      WHERE c.business_id = $1
      ORDER BY c.created_at ASC, c.clinic_name ASC, o.off_date ASC`,
    [businessId]
  );

  type Pending = {
    clinic: ClinicOffDaysItem["clinic"];
    offDays: ClinicOffDay[];
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
        offDays: [],
      };
      byClinic.set(row.clinic_id, entry);
    }
    if (row.off_id && row.off_date) {
      entry.offDays.push({
        id: row.off_id,
        clinic_id: row.clinic_id,
        off_date: row.off_date,
        reason: row.reason,
      });
    }
  }

  return Array.from(byClinic.values());
}

/**
 * Returns the off-day for a clinic on a date, or null when the clinic is
 * open. Used by the Appointments API to block bookings that land on a closed
 * day. Callers must have already verified the clinic belongs to the
 * authenticated business (verifyOwnership / scoped queries).
 */
export async function getClinicOffDayOn(
  clinicId: string,
  date: string
): Promise<{ id: string; reason: string | null } | null> {
  await ensureClinicOffDayTable();

  const result = await pool.query<{ id: string; reason: string | null }>(
    "SELECT id, reason FROM clinic_off_day WHERE clinic_id = $1 AND off_date = $2::date LIMIT 1",
    [clinicId, date]
  );
  return result.rows[0] ?? null;
}
