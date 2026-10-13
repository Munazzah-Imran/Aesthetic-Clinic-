/**
 * Server-side Role-Based Access Control (RBAC) service.
 *
 * Everything here resolves the requester's role and permissions FROM THE
 * DATABASE on every request — nothing supplied by the frontend (userId,
 * businessId, role, permission keys) is ever trusted.
 *
 * Role model (no second admin account, no duplicate owner row):
 *   - ADMIN  = the business OWNER = the EARLIEST-created user of the
 *     business (the signup transaction creates business + owner together,
 *     so no later-created account can ever become the owner) OR a user whose
 *     users.role = 'admin' (set only by migration / direct DB ops; no API
 *     ever sets this). Owners / admins get every permission key.
 *   - STAFF  = any non-owner user with a staff-account (users.role='staff',
 *     a staff_id set, and matching staff_permissions rows).
 *     Their access = exactly the permission keys stored in
 *     staff_permissions keyed by user_id + business_id (plus nothing else).
 *     Unknown users of a business (neither owner nor staff with a row) default
 *     to ZERO permissions.
 *
 * After consolidation (migration v1), staff_account fields live on users
 * (role, account_status, must_change_password, designation, staff_id) and
 * staff_permissions is keyed by user_id + business_id. There is no longer a
 * staff_members row to join.
 *
 * Enforcement layers:
 *   1. requirePermission() on API routes (the authoritative layer)
 *   2. requireAdmin() for staff/account administration
 *   3. the dashboard layout + sidebar use GET /api/auth/permissions (same
 *      resolution logic) for the UI — convenience only, never the boundary.
 */

import pool from "@/lib/db";
import { requireAuth, type AuthUser } from "@/lib/auth";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions";

export type Role = "admin" | "staff";

export type AuthContext = {
  user: AuthUser;
  businessId: string;
  role: Role;
  isAdmin: boolean;
  /** For admins this is EVERY key; for staff exactly what is stored in staff_permissions. */
  permissions: string[];
  mustChangePassword: boolean;
  designation: string | null;
  staffId: string | null;
  membershipId: string | null;
};

export type PermissionResult =
  | { ok: true; user: AuthUser; ctx: AuthContext }
  | { ok: false; status: 400 | 401 | 403; message: string };

/**
 * Resolves role + permissions for an authenticated user.
 * businessId always comes from users.business_id (JWT -> database), never
 * from the request. After consolidation, staff_account fields come from users.
 */
export async function loadAuthContext(user: AuthUser): Promise<
  | { ok: true; ctx: AuthContext }
  | { ok: false; status: 400; message: string }
> {
  const businessId = user.business_id;
  if (!businessId) {
    return {
      ok: false,
      status: 400,
      message: "No business associated with this account.",
    };
  }

  // 1) Is this user the business owner (earliest user of the business)?
  const ownerResult = await pool.query<{ is_owner: boolean }>(
    `SELECT (SELECT id FROM users WHERE business_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1) = $2 AS is_owner`,
    [businessId, user.id]
  );

  if (ownerResult.rows[0]?.is_owner) {
    return {
      ok: true,
      ctx: {
        user,
        businessId,
        role: "admin",
        isAdmin: true,
        permissions: ALL_PERMISSION_KEYS,
        mustChangePassword: false,
        designation: null,
        staffId: null,
        membershipId: null,
      },
    };
  }

  // 2) Not the owner — the user's staff-account record decides what remains.
  const membership = user.membership;
  if (!membership) {
    // A user of this business who is neither the owner nor a staff member:
    // deny everything (deny-by-default).
    return {
      ok: true,
      ctx: {
        user,
        businessId,
        role: "staff",
        isAdmin: false,
        permissions: [],
        mustChangePassword: false,
        designation: null,
        staffId: null,
        membershipId: null,
      },
    };
  }

  // 3) users.role = 'admin' can only ever be set directly in the database
  //    (no API accepts a role field) — respected if present.
  if (membership.role === "admin") {
    return {
      ok: true,
      ctx: {
        user,
        businessId,
        role: "admin",
        isAdmin: true,
        permissions: ALL_PERMISSION_KEYS,
        mustChangePassword: membership.must_change_password,
        designation: membership.designation,
        staffId: membership.staff_id,
        membershipId: String(membership.id),
      },
    };
  }

  // 4) Regular staff: exactly the stored permission keys for THIS user_id + business_id.
  const perms = await pool.query<{ permission_key: string }>(
    `SELECT sp.permission_key
       FROM staff_permissions sp
      WHERE sp.user_id = $1 AND sp.business_id = $2
      ORDER BY sp.permission_key`,
    [user.id, businessId]
  );

  return {
    ok: true,
    ctx: {
      user,
      businessId,
      role: "staff",
      isAdmin: false,
      permissions: perms.rows.map((r) => r.permission_key),
      mustChangePassword: membership.must_change_password,
      designation: membership.designation,
      staffId: membership.staff_id,
      membershipId: String(membership.id),
    },
  };
}

/**
 * The central API guard: authenticate + resolve role/permissions + require
 * ANY ONE of `required` permission keys (admins always pass).
 *
 * Returns the same `{ ok, user }` success shape as requireAuth so existing
 * handlers keep working with a one-line swap per handler.
 */
export async function requirePermission(
  request: Request,
  required: PermissionKey | PermissionKey[]
): Promise<PermissionResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;

  const resolved = await loadAuthContext(auth.user);
  if (!resolved.ok) return resolved;

  const ctx = resolved.ctx;
  if (ctx.isAdmin) return { ok: true, user: auth.user, ctx };

  const keys = Array.isArray(required) ? required : [required];
  for (const key of keys) {
    if (ctx.permissions.includes(key)) {
      return { ok: true, user: auth.user, ctx };
    }
  }

  return {
    ok: false,
    status: 403,
    message: "You do not have permission to perform this action.",
  };
}

/**
 * Guard for staff/account administration (create, edit, permissions,
 * activate/deactivate, delete). Only the business owner/admin passes; a staff member
 * who was granted the Staff page can still VIEW the list through
 * requirePermission(request, "staff") but can never mutate it.
 */
export async function requireAdmin(request: Request): Promise<PermissionResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;

  const resolved = await loadAuthContext(auth.user);
  if (!resolved.ok) return resolved;

  if (!resolved.ctx.isAdmin) {
    return {
      ok: false,
      status: 403,
      message: "Only the administrator can manage staff accounts.",
    };
  }
  return { ok: true, user: auth.user, ctx: resolved.ctx };
}

/* ---------------------------------------------------------------------- *
 * Reference-data READ sets.
 *
 * Several dashboard modules legitimately load records owned by ANOTHER
 * module (e.g. the Appointments page needs the doctors + clinics lists for
 * its dropdowns). Reads therefore accept ANY of the listed permissions,
 * while WRITES always require the owning module's permission. Business
 * isolation still applies to every query regardless of these keys.
 * ---------------------------------------------------------------------- */
export const APPOINTMENT_READERS: PermissionKey[] = [
  "appointments",
  "calendar",
  "emergency_alerts",
];
export const PATIENT_READERS: PermissionKey[] = [
  "patients",
  "appointments",
  "emergency_alerts",
];
export const DOCTOR_READERS: PermissionKey[] = ["doctor_profile", "appointments", "calendar"];
export const CLINIC_READERS: PermissionKey[] = [
  "clinics",
  "appointments",
  "calendar",
  "emergency_alerts",
  "weekly_schedule",
  "off_days",
  "special_schedules",
  "blocked_slots",
];
export const SERVICE_READERS: PermissionKey[] = ["services"];
export const SETTINGS_READERS: PermissionKey[] = [
  "settings",
  "emergency_alerts",
];
