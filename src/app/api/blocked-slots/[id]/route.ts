import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { ensureClinicBlockedSlotTable } from "@/lib/blockedSlotsDb";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

function fail(message: string, status: number) {
  return NextResponse.json(
    { data: null, error: message, success: false, message },
    { status }
  );
}

/**
 * DELETE /api/blocked-slots/[id]
 *
 * Removes ONE blocked slot entry. Business isolation happens THROUGH the
 * owning clinic: the row only matches when its clinic belongs to the
 * authenticated business, so another business's blocked slot can never be
 * deleted. Other clinics' blocked slots are unaffected.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "blocked_slots");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid blocked slot id", 400);
    }

    await ensureClinicBlockedSlotTable();

    const result = await pool.query(
      `DELETE FROM clinic_blocked_slot b
        USING clinic c
        WHERE b.id = $1
          AND b.clinic_id = c.id
          AND c.business_id = $2
        RETURNING b.id`,
      [id, auth.user.business_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      return fail("Blocked slot not found", 404);
    }

    return NextResponse.json(
      {
        data: { id },
        error: null,
        success: true,
        message: "Blocked slot removed.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /api/blocked-slots/[id] failed:", err);
    return fail("Unable to remove blocked slot", 500);
  }
}
