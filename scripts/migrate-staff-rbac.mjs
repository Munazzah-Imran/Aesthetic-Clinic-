/**
 * Idempotent migration: Staff Management + RBAC schema, CONSOLIDATED shape.
 *
 * Staff accounts live on the EXISTING users table (no second auth table, no
 * staff_members table) and page permissions live in staff_permissions keyed
 * by user_id (users.id, integer) + business_id:
 *
 *   users             — role, designation, account_status,
 *                       must_change_password, staff_id, staff_uuid, deleted_at
 *                       added with ADD COLUMN IF NOT EXISTS (existing values
 *                       and admin/owner accounts are never touched).
 *   staff_permissions — created in the CURRENT shape when missing, and the
 *                       legacy staff_member_id column (NOT NULL ->
 *                       staff_members(id)) is dropped when present so old
 *                       databases match what the application writes.
 *
 * The obsolete staff_members table and the uploaded_report /
 * virtual_consultation tables are NOT created here and have been dropped
 * from the live database; this script never recreates them.
 *
 * Schema facts this migration is built on (inspected, not assumed):
 *   - users.id is INTEGER (serial) -> staff_permissions.user_id is INTEGER.
 *   - users.business_id -> business(id) ON DELETE CASCADE.
 *   - business.id is UUID (gen_random_uuid()).
 *   - The business OWNER is derived at runtime (earliest user of the
 *     business); no separate admin account or membership row exists.
 *   - Security model: RLS is disabled on every existing table; all modules
 *     enforce tenancy at the application layer (authenticated JWT ->
 *     business_id -> WHERE business_id = $1). These tables follow the SAME
 *     model — consistent with appointments, staff_messages, etc.
 *
 * Safe to run repeatedly (CREATE TABLE/INDEX/SEQUENCE IF NOT EXISTS,
 * ADD/DROP COLUMN IF EXISTS). Run with:
 *   npm run db:migrate:staff-rbac
 */
import pool from "../src/lib/db.ts";
import { ensureIdSequences } from "../src/lib/idSequences.ts";

async function main() {
  console.log("Migrating: staff management + RBAC schema (consolidated)...");

  // ---- users: the staff-account columns (idempotent, never destructive) ----
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'staff'
       CHECK (role IN ('admin', 'staff'))`
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(100)`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'
       CHECK (account_status IN ('active', 'inactive'))`
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE`
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50) UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_uuid UUID UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  console.log("  = users staff-account columns ready");

  // ---- staff_permissions: CURRENT shape (keyed by user_id + business_id) ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_permissions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id   UUID         NOT NULL REFERENCES business(id) ON DELETE CASCADE,
      permission_key VARCHAR(60) NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, permission_key)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS staff_permissions_user_idx ON staff_permissions (user_id)`
  );

  // Legacy-shape guard: pre-consolidation databases have staff_member_id
  // NOT NULL -> staff_members(id), which would fail every new insert.
  await pool.query(
    `ALTER TABLE staff_permissions DROP CONSTRAINT IF EXISTS staff_permissions_staff_member_id_fkey`
  );
  await pool.query(`ALTER TABLE staff_permissions DROP COLUMN IF EXISTS staff_member_id`);
  console.log("  = staff_permissions table ready (keyed by user_id + business_id)");

  // STF-YYYYMMDD-XXXX staff IDs come from their own sequence (idempotent,
  // forward-only), backed by users.staff_id after the consolidation.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureIdSequences(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log("  = staff_id_sequence ready");

  console.log("Migration complete.");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
    return pool.end();
  });
