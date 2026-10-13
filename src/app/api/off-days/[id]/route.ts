import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { ensureClinicOffDayTable } from "@/lib/offDaysDb";

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
 * DELETE /api/off-days/[id]
 *
 * Removes ONE off-day entry. Business isolation happens THROUGH the owning
 * clinic: the row only matches when its clinic belongs to the authenticated
 * business, so another business's off-day can never be deleted.
 * Other clinics' off-days are unaffected.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "off_days");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid off-day id", 400);
    }

    await ensureClinicOffDayTable();

    const result = await pool.query(
      `DELETE FROM clinic_off_day o
        USING clinic c
        WHERE o.id = $1
          AND o.clinic_id = c.id
          AND c.business_id = $2
        RETURNING o.id`,
      [id, auth.user.business_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      return fail("Off-day not found", 404);
    }

    return NextResponse.json(
      {
        data: { id },
        error: null,
        success: true,
        message: "Off-day removed.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /api/off-days/[id] failed:", err);
    return fail("Unable to remove off-day", 500);
  }
}
