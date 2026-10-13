import { NextResponse } from "next/server";
import { requirePermission, requireAdmin } from "@/lib/rbac";
import { validatePermissionKeys } from "@/lib/staff";
import { loadStaff, replaceStaffPermissions } from "@/lib/staffDb";

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
 * GET /api/staff/[id]/permissions
 *
 * Loads the SAVED permission keys of one staff member from PostgreSQL
 * (scoped to the authenticated business). Requires the "staff" permission;
 * admins always pass. Another business's id returns 404.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "staff");
    if (!auth.ok) return fail(auth.message, auth.status);

    const { id } = await params;
    if (!UUID_RE.test(id)) return fail("Invalid staff id", 400);

    const staff = await loadStaff(auth.ctx.businessId, id);
    if (!staff) return fail("Staff member not found", 404);

    return envelope(
      { id: staff.id, staffId: staff.staffId, permissions: staff.permissions },
      "Permissions loaded"
    );
  } catch (err) {
    console.error("GET /api/staff/[id]/permissions failed:", err);
    return fail("Unable to load permissions", 500);
  }
}

/**
 * PUT /api/staff/[id]/permissions
 *
 * Replaces ALL permission keys of ONE staff member. ADMIN ONLY.
 *
 * Body: { permissions: string[] }
 *
 * Server-side validation: every key must exist in the shared catalog
 * (unknown keys are rejected, duplicates collapse), the target must belong
 * to the caller's business, and only admins can save — so neither a staff
 * member nor an outsider can grant themselves anything.
 *
 * The id is the stable UUID staff API handle (users.staff_uuid) — same shape
 * the rest of the app already expects.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return fail(auth.message, auth.status);
    const businessId = auth.ctx.businessId;

    const { id } = await params;
    if (!UUID_RE.test(id)) return fail("Invalid staff id", 400);

    const staff = await loadStaff(businessId, id);
    if (!staff) return fail("Staff member not found", 404);

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validatePermissionKeys(raw.permissions);
    if (!validated.ok) return fail(validated.message, 400);

    await replaceStaffPermissions(businessId, staff.id, validated.keys);

    // Return the fresh row so the UI refreshes from the database.
    const updated = await loadStaff(businessId, id);
    if (!updated) return fail("Staff member not found", 404);

    return envelope(
      { id: updated.id, staffId: updated.staffId, permissions: updated.permissions },
      "Permissions saved."
    );
  } catch (err) {
    console.error("PUT /api/staff/[id]/permissions failed:", err);
    return fail("Unable to save permissions", 500);
  }
}
