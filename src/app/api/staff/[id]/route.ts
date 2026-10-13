import { NextResponse } from "next/server";
import { requirePermission, requireAdmin } from "@/lib/rbac";
import { validatePermissionKeys, validateStaffDetails } from "@/lib/staff";
import { deleteStaff, loadStaff, updateStaffDetails } from "@/lib/staffDb";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

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

/**
 * GET /api/staff/[id]
 *
 * Loads ONE staff member's saved details + permissions fresh from
 * PostgreSQL, scoped to the authenticated business. The id is the stable UUID
 * staff API handle (users.staff_uuid) — same shape the rest of the app
 * already expects, so existing URLs / tests / bookmarks keep working.
 * An id belonging to another business (or to a deleted/non-staff user)
 * returns 404 (existence is not revealed).
 * Requires the "staff" permission; admins always pass.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "staff");
    if (!auth.ok) return fail(auth.message, auth.status);

    const { id } = await params;
    if (!UUID_RE.test(id)) return fail("Invalid staff id", 400);

    const staff = await loadStaff(auth.ctx.businessId, id);
    if (!staff) return fail("Staff member not found", 404);

    return envelope(staff, "Staff loaded");
  } catch (err) {
    console.error("GET /api/staff/[id] failed:", err);
    return fail("Unable to load staff member", 500);
  }
}

/**
 * PATCH /api/staff/[id]
 *
 * Updates details and/or account status of ONE staff member. ADMIN ONLY —
 * a staff member holding the Staff page permission can view but never
 * change accounts, and can never reach the owner (the owner has role='admin'
 * and loadStaff only returns role='staff' rows, so it returns null -> 404).
 *
 * Body (all optional): { fullName?, email?, phone?, designation?,
 *                        accountStatus? "active" | "inactive",
 *                        permissions?: string[] }
 *
 * When `permissions` is present it is validated against the catalog and
 * replaced in the SAME transaction as the details (Edit Staff form). A
 * client-sent role field is ignored entirely — roles cannot be changed
 * through this API.
 *
 * The id is the stable UUID staff API handle (users.staff_uuid) — same shape
 * the rest of the app already expects.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return fail(auth.message, auth.status);
    const businessId = auth.ctx.businessId;

    const { id } = await params;
    if (!UUID_RE.test(id)) return fail("Invalid staff id", 400);

    const existing = await loadStaff(businessId, id);
    if (!existing) return fail("Staff member not found", 404);

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    // Merge onto the SAVED record so omitted fields stay unchanged.
    const validated = validateStaffDetails({
      fullName: raw.fullName !== undefined ? raw.fullName : existing.fullName,
      email: raw.email !== undefined ? raw.email : existing.email,
      phone: raw.phone !== undefined ? raw.phone : existing.phone,
      designation: raw.designation !== undefined ? raw.designation : existing.designation,
      accountStatus:
        raw.accountStatus !== undefined ? raw.accountStatus : existing.accountStatus,
    });
    if (!validated.ok) {
      return NextResponse.json(
        {
          data: { errors: validated.errors },
          error: "Validation failed",
          success: false,
          message: "Please fix the highlighted fields.",
        },
        { status: 400 }
      );
    }
    const v = validated.data;

    // Optional full permission replacement (Edit Staff form) — validated
    // against the catalog; unknown keys are rejected, never saved.
    let permissionKeys: string[] | undefined;
    if (raw.permissions !== undefined) {
      const perms = validatePermissionKeys(raw.permissions);
      if (!perms.ok) return fail(perms.message, 400);
      permissionKeys = perms.keys;
    }

    try {
      await updateStaffDetails({
        businessId,
        staffUuid: existing.id,
        fullName: v.fullName,
        email: v.email,
        phone: v.phone,
        designation: v.designation,
        accountStatus: v.accountStatus,
        permissionKeys,
      });
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
        return fail("An account with this email already exists", 409);
      }
      throw err;
    }

    const updated = await loadStaff(businessId, id);
    if (!updated) return fail("Staff member not found", 404);

    return envelope(updated, "Staff member updated.");
  } catch (err) {
    console.error("PATCH /api/staff/[id] failed:", err);
    return fail("Unable to update staff member", 500);
  }
}

/**
 * DELETE /api/staff/[id]
 *
 * Deletes ONE staff member (safe soft-delete on users, since a hard delete of
 * the users row would cascade into staff_messages/staff_permissions and erase
 * inbox history + the permission ledger). ADMIN ONLY — a staff member holding
 * the Staff page permission can view the list but can never delete accounts.
 *
 * Safety (see deleteStaff in src/lib/staffDb.ts for the transaction):
 *   - target must be a non-deleted staff member belonging to the AUTHENTICATED
 *     ADMIN's business (404 otherwise),
 *   - self-deletion is refused (400),
 *   - admin-role memberships are refused (403),
 *   - the business OWNER (earliest user) is refused (403),
 *   - the staff users row is soft-deleted (account_status='inactive' +
 *     deleted_at=NOW()) and its staff_permissions rows are removed in ONE
 *     transaction: any existing JWT is rejected with 401 on the very next
 *     request, and login is refused — while staff_messages, appointments,
 *     patients and every other business record stay intact.
 *
 * The id is the stable UUID staff API handle (users.staff_uuid) — same shape
 * the rest of the app already expects.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return fail(auth.message, auth.status);

    const { id } = await params;
    if (!UUID_RE.test(id)) return fail("Invalid staff id", 400);

    const result = await deleteStaff({
      businessId: auth.ctx.businessId,
      staffUuid: id,
      callerUserId: auth.user.id,
    });
    if (!result.ok) return fail(result.message, result.status);

    return envelope(null, "Staff member deleted.");
  } catch (err) {
    console.error("DELETE /api/staff/[id] failed:", err);
    return fail("Unable to delete staff member", 500);
  }
}
