import pool from "@/lib/db";
import { verifyAuthToken } from "@/lib/jwt";

export type AuthMembership = {
  id: number; // now = users.id (the stable handle for staff account + permissions)
  staff_id: string | null; // users.staff_id (display handle; null for owners / non-staff)
  role: "staff" | "admin";
  account_status: "active" | "inactive";
  must_change_password: boolean;
  designation: string | null;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  business_id: string | null;
  /** After consolidation, every user has these membership fields directly on users. */
  membership: AuthMembership | null;
};

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: 401 | 403; message: string };

/** Flat row shape returned by the users query (pg cannot nest). */
type AuthUserRow = {
  id: number;
  name: string;
  email: string;
  business_id: string | null;
  role: "staff" | "admin" | null;
  account_status: "active" | "inactive" | null;
  must_change_password: boolean | null;
  designation: string | null;
  staff_id: string | null;
};

/**
 * Endpoints a staff account may still call BEFORE completing the forced
 * first-login password change: resolving their own identity/permissions and
 * the password change itself. Everything else returns 403 until it is done.
 *
 * After consolidation, staff-account fields live directly on users
 * (role, account_status, must_change_password, designation, staff_id).
 * There is no longer a separate staff_members row to join — ownership is
 * still determined by "earliest user of the business" in rbac.ts.
 */
const PASSWORD_CHANGE_ALLOWLIST: ReadonlySet<string> = new Set([
  "/api/auth/me",
  "/api/auth/permissions",
  "/api/password",
]);

export async function requireAuth(request: Request): Promise<AuthResult> {
  // 1. Extract Bearer token.
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false, status: 401, message: "Not authenticated" };
  }

  // 2. Verify via the existing JWT utility.
  const payload = verifyAuthToken(token);
  if (!payload) {
    return { ok: false, status: 401, message: "Invalid or expired token" };
  }

  // 3. Load the user (with staff-account fields) from the database.
  //    Every user carries its own membership fields now — no separate join.
  const result = await pool.query<AuthUserRow>(
    `SELECT u.id, u.name, u.email, u.business_id,
            u.role, u.account_status, u.must_change_password, u.designation,
            u.staff_id
       FROM users u
      WHERE u.id = $1
      LIMIT 1`,
    [payload.sub]
  );
  const row = result.rows[0];
  if (!row) {
    return { ok: false, status: 401, message: "Account no longer exists" };
  }

  const user: AuthUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    business_id: row.business_id,
    membership:
      row.role === null && row.account_status === null && row.designation === null
        ? null
        : {
            id: row.id,
            staff_id: row.staff_id,
            role: row.role ?? "staff",
            account_status: row.account_status ?? "inactive",
            must_change_password: row.must_change_password ?? false,
            designation: row.designation ?? null,
          },
  };

  // 4. Deactivated staff: revoke access immediately (401 -> client logs out).
  //    After consolidation, account_status lives on users, so any inactive user
  //    (staff OR owner with account_status='inactive') is blocked here.
  if (row.account_status && row.account_status === "inactive") {
    return {
      ok: false,
      status: 401,
      message: "Your account has been deactivated. Please contact the administrator.",
    };
  }

  // 5. Forced first-login password change: only account/password endpoints
  //    are reachable until the staff member sets their own password.
  if (user.membership?.must_change_password) {
    const path = new URL(request.url).pathname;
    if (!PASSWORD_CHANGE_ALLOWLIST.has(path)) {
      return {
        ok: false,
        status: 403,
        message: "Please set a new password before continuing.",
      };
    }
  }

  return { ok: true, user };
}
