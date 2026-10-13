/**
 * Server-only helpers for the `service` table (Services / Treatments).
 *
 * Every row belongs to ONE business through `business_id` (UUID FK,
 * ON DELETE CASCADE). Business isolation always uses the business id
 * resolved from the authenticated user — never one sent by the frontend.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import type { ServiceRow } from "@/lib/services";

let tableEnsured = false;

/**
 * Idempotent bootstrap for `service` (same philosophy as scripts/db-init.ts:
 * safe to run repeatedly, only creates what is missing).
 *
 * - Reuses an existing service table when present (never a duplicate table).
 * - FK: business_id -> business(id) ON DELETE CASCADE.
 * - CHECK: status is always 'active' or 'inactive'.
 */
export async function ensureServiceTable(): Promise<void> {
  if (tableEnsured) return;

  const businessTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'business' LIMIT 1"
  );
  if ((businessTable.rowCount ?? 0) === 0) {
    // The business table itself has not been bootstrapped yet — try again later.
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id   UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
      service_title VARCHAR(255) NOT NULL,
      category      VARCHAR(100) NOT NULL,
      status        VARCHAR(10) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS service_business_idx
      ON service (business_id, service_title)
  `);

  tableEnsured = true;
}

/**
 * Loads every service of the authenticated business, newest first.
 *
 * Business isolation: WHERE business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 */
export async function loadServices(businessId: string): Promise<ServiceRow[]> {
  await ensureServiceTable();

  const result = await pool.query<ServiceRow>(
    `SELECT id, business_id, service_title, category, status,
            created_at, updated_at
       FROM service
      WHERE business_id = $1
      ORDER BY service_title ASC`,
    [businessId]
  );
  return result.rows;
}
