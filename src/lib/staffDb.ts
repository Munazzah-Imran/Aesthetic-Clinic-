/**
 * Staff Management  --  server-only PostgreSQL helpers (parameterized queries
 * everywhere; business isolation is ALWAYS applied through business_id that
 * the API layer resolves from the authenticated JWT).
 *
 * After consolidation (migration v1/v1b + v2) the staff-account fields live on
 * the EXISTING users table (role, designation, account_status,
 * must_change_password, staff_id, staff_uuid, deleted_at) and page permissions
 * live in staff_permissions keyed by user_id (users.id, integer) + business_id.
 * staff_members is dropped by migration v2 (after this code is migrated and
 * verified); until then the old table may still exist but this module never
 * reads or writes it.
 *
 * Stable staff API handle = users.staff_uuid (UUID)  --  same shape the
 * UI/routes/tests already expect (UUID_RE validated), so URLs, tests and
 * bookmarks are unchanged. Page permissions are keyed by users.id (integer),
 * exactly as the refactor spec requires (Talha's user ID -> dashboard,
 * doctor_profile, clinics, ...).
 *
 * The lazy ensureStaffTables() now only guarantees the NEW columns on users and
 * the redesigned staff_permissions exist; it no longer creates/updates
 * staff_members.
 */

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { withSequentialId } from "@/lib/sequentialId";
import type { AccountStatus, StaffRecord } from "@/lib/staff";

export type StaffRow = {
  id: string; // users.staff_uuid (stable UUID staff API handle)
  staff_id: string | null; // users.staff_id (STF-YYYYMMDD-XXXX display id)
  user_id: number; // users.id (integer)  --  the key for staff_permissions
  business_id: string;
  business_name: string | null;
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  role: "staff" | "admin";
  account_status: AccountStatus;
  must_change_password: boolean;
  created_at: Date;
  deleted_at: Date | null;
  permissions: string[] | null;
};

/**
 * Maps a raw staff SQL row to the public StaffRecord shape (camelCase, no
 * secrets: the password hash and JWT material never appear in StaffRow).
 * `staff_id` / `designation` / `permissions` are nullable in SQL but the UI
 * expects strings/arrays, so they fall back to "" / [].
 * users has no updated_at column, so updatedAt mirrors created_at.
 */
function mapStaff(row: StaffRow): StaffRecord {
  return {
    id: row.id,
    staffId: row.staff_id ?? "",
    userId: row.user_id,
    fullName: row.name,
    email: row.email,
    phone: row.phone,
    designation: row.designation ?? "",
    role: row.role,
    accountStatus: row.account_status,
    mustChangePassword: row.must_change_password,
    permissions: row.permissions ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.created_at.toISOString(),
  };
}

let tablesEnsured: Promise<void> | null = null;

/**
 * Lazy, idempotent guarantee that the CONSOLIDATED schema exists:
 *   - users has the staff-account columns (role, designation, account_status,
 *     must_change_password, staff_id, staff_uuid, deleted_at)
 *   - staff_permissions is keyed by user_id (users.id) + business_id with the
 *     UNIQUE(user_id, permission_key) guard
 *
 * This replaces the old ensureStaffTables() that created/updated staff_members.
 * staff_members is dropped by migration v2 (after this code is migrated and
 * verified)  --  until then the old table may still exist but this module never
 * touches it.
 */
export function ensureStaffTables(): Promise<void> {
  if (!tablesEnsured) {
    tablesEnsured = (async () => {
      await pool.query(
        `ALTER TABLE users
          ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'staff'
            CHECK (role IN ('admin', 'staff'))`
      );
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(100)`
      );
      await pool.query(
        `ALTER TABLE users
          ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'
            CHECK (account_status IN ('active', 'inactive'))`
      );
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE`
      );
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50) UNIQUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_uuid UUID UNIQUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

      await pool.query(
        `CREATE TABLE IF NOT EXISTS staff_permissions (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          business_id   UUID         NOT NULL REFERENCES business(id) ON DELETE CASCADE,
          permission_key VARCHAR(60) NOT NULL,
          created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, permission_key)
        )`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS staff_permissions_user_idx ON staff_permissions (user_id)`
      );

      // Legacy-shape guard: databases created before the consolidation still
      // have staff_permissions.staff_member_id NOT NULL -> staff_members(id).
      // New code only writes (user_id, business_id, permission_key), so that
      // column would fail every insert. It is dropped here (idempotently) so
      // the schema always matches what this module writes; the staff_members
      // table itself is retired (dropped) by the consolidation migration.
      await pool.query(
        `ALTER TABLE staff_permissions DROP CONSTRAINT IF EXISTS staff_permissions_staff_member_id_fkey`
      );
      await pool.query(
        `ALTER TABLE staff_permissions DROP COLUMN IF EXISTS staff_member_id`
      );
    })().catch((err) => {
      tablesEnsured = null;
      throw err;
    });
  }
  return tablesEnsured;
}

/** Every staff member of ONE business, newest first (business-scoped). */
export async function listStaff(businessId: string): Promise<StaffRecord[]> {
  await ensureStaffTables();
  const result = await pool.query<StaffRow>(
    `SELECT
         u.staff_uuid AS id,
         u.staff_id,
         u.id        AS user_id,
         u.business_id,
         u.name,
         u.email,
         u.phone,
         u.designation,
         u.role,
         u.account_status,
         u.must_change_password,
         u.created_at,
         u.deleted_at,
         COALESCE(
           array_agg(sp.permission_key) FILTER (WHERE sp.permission_key IS NOT NULL),
           '{}'
         ) AS permissions,
         b.business_name
       FROM users u
       JOIN business b ON b.id = u.business_id
       LEFT JOIN staff_permissions sp
              ON sp.user_id = u.id AND sp.business_id = u.business_id
      WHERE u.business_id = $1
        AND u.role = 'staff'
        AND u.deleted_at IS NULL
      GROUP BY u.id, b.id
      ORDER BY u.created_at DESC`,
    [businessId]
  );
  return result.rows.map(mapStaff);
}

/**
 * One staff member WITHIN the caller's business. Returns null when the staff
 * uuid does not exist, belongs to another business, is not a staff member, or
 * has been soft-deleted  --  the API layer turns that into a 404 so cross-
 * business probing reveals nothing.
 *
 * `staffUuid` is `users.staff_uuid` (the stable UUID staff API handle), NOT
 * `users.id`  --  permissions are keyed by `users.id` only.
 */
export async function loadStaff(
  businessId: string,
  staffUuid: string
): Promise<StaffRecord | null> {
  await ensureStaffTables();
  const result = await pool.query<StaffRow>(
    `SELECT
         u.staff_uuid AS id,
         u.staff_id,
         u.id        AS user_id,
         u.business_id,
         u.name,
         u.email,
         u.phone,
         u.designation,
         u.role,
         u.account_status,
         u.must_change_password,
         u.created_at,
         u.deleted_at,
         COALESCE(
           array_agg(sp.permission_key) FILTER (WHERE sp.permission_key IS NOT NULL),
           '{}'
         ) AS permissions,
         b.business_name
       FROM users u
       JOIN business b ON b.id = u.business_id
       LEFT JOIN staff_permissions sp
              ON sp.user_id = u.id AND sp.business_id = u.business_id
      WHERE u.business_id = $1
        AND u.staff_uuid = $2
        AND u.role = 'staff'
        AND u.deleted_at IS NULL
      GROUP BY u.id, b.id
      LIMIT 1`,
    [businessId, staffUuid]
  );
  const row = result.rows[0];
  return row ? mapStaff(row) : null;
}

/**
 * Creates the login account in the EXISTING users table (never a second auth
 * table), the staff_id display handle, and the initial page permission rows
 * in staff_permissions (keyed by users.id  --  integer, as the refactor spec
 * requires) in ONE transaction  --  a failure at any step rolls everything back,
 * so a half-created staff account can never exist.
 *
 * Duplicate emails surface as PostgreSQL unique violation 23505.
 *
 * role is always 'staff': a client-sent role field is ignored, so staff can
 * never be created (or promoted) as admin through this API.
 *
 * staff_uuid is the stable UUID staff API handle (users.staff_uuid). It is set
 * to a freshly generated UUID that will be returned as the staff record id, so
 * the staff API URL format (UUID) is unchanged.
 */
export async function createStaff(params: {
  businessId: string;
  fullName: string;
  email: string;
  passwordHash: string;
  phone: string | null;
  designation: string;
  accountStatus: AccountStatus;
  permissionKeys: string[];
}): Promise<StaffRecord> {
  await ensureStaffTables();

  const created = await withSequentialId("STF", async (staffCode, client: PoolClient) => {
    // 1. Create the login account in users (the only auth table) + the display
    //    handle (staff_id = STF-YYYYMMDD-XXXX) + the stable staff UUID handle.
    const userInsert = await client.query<{ id: number; staff_uuid: string }>(
      `INSERT INTO users (
          name, email, password, business_id,
          role, designation, account_status, must_change_password, phone,
          staff_id, staff_uuid
        ) VALUES (
          $1, $2, $3, $4,
          'staff', $5, $6, TRUE, $7, $8, gen_random_uuid()
        )
       RETURNING id, staff_uuid`,
      [
        params.fullName,
        params.email,
        params.passwordHash,
        params.businessId,
        params.designation,
        params.accountStatus,
        params.phone,
        staffCode, // STF-YYYYMMDD-XXXX display handle
      ]
    );
    const userId = userInsert.rows[0].id;
    const staffUuid = userInsert.rows[0].staff_uuid;

    // 2. The initial page permission rows, keyed by users.id (integer).
    if (params.permissionKeys.length > 0) {
      await client.query(
        `INSERT INTO staff_permissions (user_id, business_id, permission_key)
         SELECT $1, $2, unnest($3::varchar(60)[])
         ON CONFLICT DO NOTHING`,
        [userId, params.businessId, params.permissionKeys]
      );
    }

    return { userId, staffUuid };
  });

  const record = await loadStaff(params.businessId, created.staffUuid);
  if (!record) throw new Error("Staff member vanished right after insert");
  return record;
}

/**
 * Updates details (and optionally the full permission set) of ONE staff
 * member scoped to the caller's business, in a single transaction
 * (users + staff_permissions stay consistent). Duplicate emails surface as
 * 23505 for the route to map to 409.
 *
 * `staffUuid` is `users.staff_uuid` (the stable UUID staff API handle).
 * Permission rows are keyed by `users.id` (integer).
 */
export async function updateStaffDetails(params: {
  businessId: string;
  staffUuid: string;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string;
  accountStatus: AccountStatus;
  permissionKeys?: string[];
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locate the staff users row by staff_uuid within the caller's business.
    const locate = await client.query<{ id: number }>(
      `SELECT id FROM users
        WHERE staff_uuid = $1 AND business_id = $2
          AND role = 'staff'
          AND deleted_at IS NULL
        LIMIT 1`,
      [params.staffUuid, params.businessId]
    );
    const userId = locate.rows[0]?.id;
    if (userId == null) {
      throw Object.assign(new Error("Staff member not found in this business"), {
        code: "STAFF_NOT_FOUND",
      });
    }

    // Update the users row (name, email, phone, designation, account_status).
    await client.query(
      `UPDATE users
          SET name = $2, email = $3, phone = $4, designation = $5,
              account_status = $6
        WHERE id = $1 AND business_id = $7`,
      [
        userId,
        params.fullName,
        params.email,
        params.phone,
        params.designation,
        params.accountStatus,
        params.businessId,
      ]
    );

    // Replace the full permission set (keyed by users.id).
    if (params.permissionKeys !== undefined) {
      await client.query(
        `DELETE FROM staff_permissions
          WHERE user_id = $1 AND business_id = $2`,
        [userId, params.businessId]
      );
      if (params.permissionKeys.length > 0) {
        await client.query(
          `INSERT INTO staff_permissions (user_id, business_id, permission_key)
           SELECT $1, $2, unnest($3::varchar(60)[])
           ON CONFLICT DO NOTHING`,
          [userId, params.businessId, params.permissionKeys]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replaces ALL permission rows of one staff member (transaction, no dupes).
 * Permission rows are keyed by `users.id` (integer) + business_id, NOT by the
 * staff_api handle (staff_uuid). The caller must already have verified that the
 * staff uuid belongs to the caller's business (loadStaff-style check).
 *
 * `staffUuid` is `users.staff_uuid` (the stable UUID staff API handle), used
 * only to look up the underlying users.id for this replacement.
 */
export async function replaceStaffPermissions(
  businessId: string,
  staffUuid: string,
  permissionKeys: string[]
): Promise<void> {
  // Resolve the integer users.id for this staff uuid within the caller's
  // business, then replace the permission rows keyed by that id.
  const locate = await pool.query<{ id: number }>(
    `SELECT id FROM users
       WHERE staff_uuid = $1 AND business_id = $2
         AND role = 'staff'
         AND deleted_at IS NULL
       LIMIT 1`,
    [staffUuid, businessId]
  );
  const userId = locate.rows[0]?.id;
  if (userId == null) {
    throw Object.assign(new Error("Staff member not found in this business"), {
      code: "STAFF_NOT_FOUND",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM staff_permissions
        WHERE user_id = $1 AND business_id = $2`,
      [userId, businessId]
    );

    if (permissionKeys.length > 0) {
      await client.query(
        `INSERT INTO staff_permissions (user_id, business_id, permission_key)
         SELECT $1, $2, unnest($3::varchar(60)[])
         ON CONFLICT DO NOTHING`,
        [userId, businessId, permissionKeys]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes ONE staff member  --  SAFE SOFT-DELETE in a single transaction.
 *
 * After consolidation (migration v1/v1b + v2) the staff-account fields live on
 * the EXISTING users table and page permissions are keyed by users.id (integer).
 * There is no longer a staff_members row to join or update.
 *
 * Why not a hard delete of the users row? The inspected foreign keys make
 * it destructive for historical business records:
 *   - staff_messages.sender_id/recipient_id REFERENCES users(id)
 *     ON DELETE CASCADE  → the staff inbox history would be erased
 *   - staff_permissions references users(id) ON DELETE CASCADE  --  killing the
 *     users row would also erase the permission ledger
 * appointments, patients and reports do not reference users at all, but the
 * message/inbox cascade alone disqualifies a hard delete per the requirements.
 *
 * What the transaction does (all or nothing):
 *   1. Locks the staff users row FOR UPDATE, scoped to the caller's business
 *      and to a non-deleted staff row (cross-business / non-staff / already-
 *      deleted -> 404).
 *   2. Refuses self-deletion (caller's own user_id) and the business OWNER
 *      (the earliest user of the business) and any admin-role row.
 *   3. Marks the users row account_status='inactive' + deleted_at=NOW()  -- 
 *      requireAuth re-reads account_status on EVERY request (immediate 401 for
 *      any existing token) and login refuses inactive accounts, so the account
 *      can neither log in nor reach any protected API again.
 *   4. Deletes the staff_permissions rows for this user_id (assignments fully
 *      removed), so the deleted account has no page access.
 *   5. Keeps the users row itself (personal/contact data) and every other
 *      business record (staff_messages, appointments, patients, reports, ...)
 *      untouched.
 *
 * No application path ever un-deletes the row: listStaff/loadStaff filter
 * deleted_at IS NULL AND role='staff', so the member vanishes from the list
 * and every staff API returns 404 for it.
 *
 * `staffUuid` is `users.staff_uuid` (the stable UUID staff API handle).
 */
export async function deleteStaff(params: {
  businessId: string;
  staffUuid: string;
  /** The authenticated admin's users.id  --  self-deletion is refused. */
  callerUserId: number;
}): Promise<{ ok: true; membershipId: string } | { ok: false; status: 400 | 403 | 404; message: string }> {
  await ensureStaffTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the staff users row (by staff_uuid, within the caller's business,
    // only a non-deleted staff member). Cross-business / non-staff / already-
    // deleted -> 404 (after ROLLBACK).
    const locked = await client.query<{
      id: number;
      role: "staff" | "admin";
    }>(
      `SELECT id, role
         FROM users
        WHERE staff_uuid = $1 AND business_id = $2
          AND role = 'staff'
          AND deleted_at IS NULL
        FOR UPDATE`,
      [params.staffUuid, params.businessId]
    );
    const target = locked.rows[0];
    if (!target) {
      await client.query("ROLLBACK").catch(() => {});
      return { ok: false, status: 404, message: "Staff member not found" };
    }

    // Self-deletion is refused (you cannot delete your own account).
    if (target.id === params.callerUserId) {
      await client.query("ROLLBACK").catch(() => {});
      return { ok: false, status: 400, message: "You cannot delete your own account." };
    }

    // The business OWNER (earliest user of the business, role='admin') can
    // never be deleted through this API.
    const owner = await client.query<{ id: number }>(
      `SELECT id FROM users
        WHERE business_id = $1 AND role = 'admin'
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [params.businessId]
    );
    if (owner.rows[0]?.id === target.id) {
      await client.query("ROLLBACK").catch(() => {});
      return {
        ok: false,
        status: 403,
        message: "The business owner's account cannot be deleted.",
      };
    }

    // Soft-delete the users row: revoke access (inactive) + hide permanently
    // (deleted_at). requireAuth/loadStaff/listStaff all honor deleted_at.
    const updated = await client.query(
      `UPDATE users
          SET account_status = 'inactive',
              deleted_at = NOW()
        WHERE id = $1 AND business_id = $2
          AND deleted_at IS NULL`,
      [target.id, params.businessId]
    );
    if ((updated.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK").catch(() => {});
      return { ok: false, status: 404, message: "Staff member not found" };
    }

    // Remove every permission assignment for this user in the SAME transaction
    // (staff_permissions is keyed by users.id + business_id).
    await client.query(
      `DELETE FROM staff_permissions
        WHERE user_id = $1 AND business_id = $2`,
      [target.id, params.businessId]
    );

    await client.query("COMMIT");
    return { ok: true, membershipId: params.staffUuid };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Clears the forced first-login password change flag for one staff user
 * (called by PATCH /api/password after the new password has been verified +
 * stored). Only affects staff (role = 'staff'); owners are never gated by this
 * flag, so the update is scoped to staff rows and is a safe no-op for owners.
 *
 * After consolidation the flag lives on users.must_change_password.
 */
export async function clearMustChangePassword(userId: number): Promise<void> {
  await ensureStaffTables();
  await pool.query(
    `UPDATE users SET must_change_password = FALSE
      WHERE id = $1 AND role = 'staff'`,
    [userId]
  );
}
