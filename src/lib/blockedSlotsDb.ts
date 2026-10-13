/**
 * Server-only helpers for the `clinic_blocked_slot` table.
 *
 * The table is linked to the EXISTING `clinic` table through `clinic_id`
 * (UUID FK, ON DELETE CASCADE) — clinics are never identified by name or
 * city. Business isolation always happens THROUGH the clinic join using the
 * business id resolved from the authenticated user.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import type { ClinicBlockedSlot, ClinicBlockedSlotsItem } from "@/lib/blockedSlots";

let tableEnsured = false;

/**
 * Idempotent bootstrap for `clinic_blocked_slot` (same philosophy as
 * scripts/db-init.ts: safe to run repeatedly, only creates what is missing).
 *
 * - Reuses an existing blocked-slot table when present (never a duplicate table).
 * - FK: clinic_id -> clinic(id) ON DELETE CASCADE, so deleting a clinic can
 *   never leave orphaned blocked slots.
 * - CHECK: end_time must be after start_time (defense in depth beyond validation).
 */
export async function ensureClinicBlockedSlotTable(): Promise<void> {
  if (tableEnsured) return;

  const clinicTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clinic' LIMIT 1"
  );
  if ((clinicTable.rowCount ?? 0) === 0) {
    // The clinic table itself has not been bootstrapped yet — try again later.
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinic_blocked_slot (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id   UUID NOT NULL REFERENCES clinic(id) ON DELETE CASCADE,
      block_date  DATE NOT NULL,
      start_time  TIME NOT NULL,
      end_time    TIME NOT NULL,
      reason      VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinic_blocked_slot_time_check CHECK (end_time > start_time),
      CONSTRAINT clinic_blocked_slot_unique UNIQUE (clinic_id, block_date, start_time, end_time)
    )
  `);

  tableEnsured = true;
}

/**
 * Loads every clinic of the authenticated business together with its
 * blocked slots (so each clinic always has a card, even with zero entries).
 *
 * Business isolation: WHERE c.business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 */
export async function loadBlockedSlotsByClinic(
  businessId: string
): Promise<ClinicBlockedSlotsItem[]> {
  await ensureClinicBlockedSlotTable();

  type JoinedRow = {
    clinic_id: string;
    clinic_name: string;
    city: string;
    clinic_status: string;
    slot_id: string | null;
    block_date: string | null;
    start_time: string | null;
    end_time: string | null;
    reason: string | null;
  };

  const result = await pool.query<JoinedRow>(
    `SELECT c.id AS clinic_id,
            c.clinic_name,
            c.city,
            c.status AS clinic_status,
            b.id AS slot_id,
            TO_CHAR(b.block_date, 'YYYY-MM-DD') AS block_date,
            TO_CHAR(b.start_time, 'HH24:MI') AS start_time,
            TO_CHAR(b.end_time, 'HH24:MI') AS end_time,
            b.reason
       FROM clinic c
       LEFT JOIN clinic_blocked_slot b ON b.clinic_id = c.id
      WHERE c.business_id = $1
      ORDER BY c.created_at ASC, c.clinic_name ASC, b.block_date ASC, b.start_time ASC`,
    [businessId]
  );

  type Pending = {
    clinic: ClinicBlockedSlotsItem["clinic"];
    slots: ClinicBlockedSlot[];
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
        slots: [],
      };
      byClinic.set(row.clinic_id, entry);
    }
    if (row.slot_id && row.block_date && row.start_time && row.end_time) {
      entry.slots.push({
        id: row.slot_id,
        clinic_id: row.clinic_id,
        block_date: row.block_date,
        start_time: row.start_time,
        end_time: row.end_time,
        reason: row.reason,
      });
    }
  }

  return Array.from(byClinic.values());
}

/**
 * Returns the blocked slot covering a time on a date for a clinic, or null
 * when the time is bookable. The range is half-open: [start_time, end_time).
 * Callers must have already verified the clinic belongs to the
 * authenticated business (verifyOwnership / scoped queries).
 */
export async function getClinicBlockedSlotAt(
  clinicId: string,
  date: string,
  time: string
): Promise<{ id: string; start_time: string; end_time: string; reason: string | null } | null> {
  await ensureClinicBlockedSlotTable();

  const result = await pool.query<{
    id: string;
    start_time: string;
    end_time: string;
    reason: string | null;
  }>(
    `SELECT id,
            TO_CHAR(start_time, 'HH24:MI') AS start_time,
            TO_CHAR(end_time, 'HH24:MI') AS end_time,
            reason
       FROM clinic_blocked_slot
      WHERE clinic_id = $1
        AND block_date = $2::date
        AND $3::time >= start_time
        AND $3::time < end_time
      LIMIT 1`,
    [clinicId, date, time]
  );
  return result.rows[0] ?? null;
}

/**
 * True when the range [startTime, endTime) overlaps an EXISTING blocked
 * slot for this clinic on this date. Used to reject duplicate/overlapping
 * blocks up-front so the list stays readable.
 *
 * `excludeId` lets a future edit route skip its own row.
 */
export async function hasOverlappingBlockedSlot(
  clinicId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<boolean> {
  await ensureClinicBlockedSlotTable();

  const result = await pool.query(
    `SELECT 1 FROM clinic_blocked_slot
      WHERE clinic_id = $1
        AND block_date = $2::date
        AND start_time < $4::time
        AND end_time > $3::time
        AND ($5::uuid IS NULL OR id != $5::uuid)
      LIMIT 1`,
    [clinicId, date, startTime, endTime, excludeId ?? null]
  );
  return result.rows.length > 0;
}
