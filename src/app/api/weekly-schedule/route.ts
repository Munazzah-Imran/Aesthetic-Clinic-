import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { loadWeeklySchedules } from "@/lib/weeklyScheduleDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/weekly-schedule
 *
 * Returns EVERY clinic of the authenticated business together with its own
 * Monday→Sunday schedule:
 *
 *   {
 *     success: true,
 *     data: [
 *       {
 *         clinic: { id, clinic_name, city, status },
 *         schedule: [
 *           { day: "Monday", is_open: true, opening_time: "16:00", closing_time: "21:00" },
 *           ...
 *           { day: "Sunday", is_open: false, opening_time: null, closing_time: null }
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Business isolation: the business id comes from the authenticated user
 * (JWT -> users.business_id), never from the request. Clinic name and city
 * are read live from the existing `clinic` table, so edits in the Clinics
 * module show up here automatically.
 */
function envelope(
  data: unknown,
  message: string,
  success = true,
  error: string | null = null,
  status = 200
) {
  return NextResponse.json({ data, error, success, message }, { status });
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "weekly_schedule");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(
        null,
        "No business associated with this account",
        false,
        "No business associated with this account",
        400
      );
    }

    const data = await loadWeeklySchedules(auth.user.business_id);

    return envelope(data, "Weekly schedule loaded");
  } catch (err) {
    console.error("GET /api/weekly-schedule failed:", err);
    return envelope(
      null,
      "Unable to load weekly schedule",
      false,
      "Unable to load weekly schedule",
      500
    );
  }
}
