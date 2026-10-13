import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission, requireAdmin } from "@/lib/rbac";
import {
  validateInitialPassword,
  validatePermissionKeys,
  validateStaffDetails,
} from "@/lib/staff";
import { createStaff, listStaff } from "@/lib/staffDb";

export const dynamic = "force-dynamic";

function envelope(
  data: unknown,
  message: string,
  success = true,
  error: string | null = null,
  status = 200
) {
  return NextResponse.json({ data, error, success, message }, { status });
}

function fail(message: string, status: number) {
  return envelope(null, message, false, message, status);
}

/** Map raw PostgreSQL errors to safe public messages (never leak internals). */
function mapDbError(err: unknown): { status: number; message: string } | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: string }).code;
  if (code === "23505") {
    return { status: 409, message: "An account with this email already exists" };
  }
  return null;
}

/**
 * GET /api/staff
 *
 * Lists the staff members of the AUTHENTICATED business (never a client-
 * sent business id). Requires the "staff" permission — admins always pass.
 * Returns safe fields only: no password hashes, no secrets.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "staff");
    if (!auth.ok) return fail(auth.message, auth.status);

    const staff = await listStaff(auth.ctx.businessId);
    return envelope(staff, "Staff loaded");
  } catch (err) {
    console.error("GET /api/staff failed:", err);
    return fail("Unable to load staff", 500);
  }
}

/**
 * POST /api/staff
 *
 * Creates ONE staff login account (existing users table — never a duplicate
 * auth table), its membership and its EXPLICITLY assigned page permissions
 * in a single transaction.
 *
 * ADMIN ONLY. Body:
 *   { fullName, email, phone?, designation, accountStatus,
 *     password, confirmPassword, permissions: string[] }
 *
 * - password: initial/temporary password; stored ONLY as a bcrypt hash and
 *   never returned. The staff member MUST change it on first login
 *   (users.must_change_password = TRUE).
 * - permissions: validated against the catalog; an empty list means no
 *   dashboard pages — nothing is granted implicitly.
 * - role is always 'staff': a client-sent role field is ignored, so staff
 *   can never be created (or promoted) as admin through this API.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return fail(auth.message, auth.status);
    const businessId = auth.ctx.businessId;

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const details = validateStaffDetails({
      fullName: raw.fullName,
      email: raw.email,
      phone: raw.phone,
      designation: raw.designation,
      accountStatus: raw.accountStatus,
    });
    const password = validateInitialPassword(raw.password, raw.confirmPassword);
    const permissions = validatePermissionKeys(raw.permissions ?? []);

    const errors = {
      ...(details.ok ? {} : details.errors),
      ...(password.ok ? {} : password.errors),
      ...(permissions.ok ? {} : { permissions: permissions.message }),
    };
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        {
          data: { errors },
          error: "Validation failed",
          success: false,
          message: "Please fix the highlighted fields.",
        },
        { status: 400 }
      );
    }
    if (!details.ok || !password.ok || !permissions.ok) return fail("Validation failed", 400);

    // Create in ONE transaction (users row + staff_id display handle +
    // staff_uuid stable handle + staff_permissions rows, or none of them).
    // A duplicate email raises unique-violation 23505 inside the transaction
    // -> rollback -> mapped to 409 below.
    const created = await createStaff({
      businessId,
      fullName: details.data.fullName,
      email: details.data.email,
      passwordHash: await bcrypt.hash(password.password, 10),
      phone: details.data.phone,
      designation: details.data.designation,
      accountStatus: details.data.accountStatus,
      permissionKeys: permissions.keys,
    });

    return envelope(created, "Staff account created.", true, null, 201);
  } catch (err) {
    const mapped = mapDbError(err);
    if (mapped) return fail(mapped.message, mapped.status);
    console.error("POST /api/staff failed:", err);
    return fail("Unable to create staff account", 500);
  }
}
