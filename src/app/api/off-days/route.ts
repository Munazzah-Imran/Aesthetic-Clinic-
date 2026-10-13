import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { validateOffDay, type ClinicOffDay } from "@/lib/offDays";
import { ensureClinicOffDayTable, loadOffDaysByClinic } from "@/lib/offDaysDb";
import { ensureClinicSpecialScheduleTable } from "@/lib/specialSchedulesDb";

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

/**
 * GET /api/off-days
 *
 * Returns EVERY clinic of the authenticated business together with its
 * off-days (single closed dates):
 *
 *   {
 *     success: true,
 *     data: [
 *       {
 *         clinic: { id, clinic_name, city, status },
 *         offDays: [ { id, clinic_id, off_date: "2026-12-25", reason: "..." } ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Business isolation: the business id comes from the authenticated user
 * (JWT -> users.business_id), never from the request.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "off_days");
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

    const data = await loadOffDaysByClinic(auth.user.business_id);

    return envelope(data, "Off-days loaded");
  } catch (err) {
    console.error("GET /api/off-days failed:", err);
    return envelope(null, "Unable to load off-days", false, "Unable to load off-days", 500);
  }
}

/**
 * POST /api/off-days
 *
 * Marks one single date as an off-day for ONE clinic.
 *
 * Body: { clinicId: "<uuid>", offDate: "YYYY-MM-DD", reason?: "..." }
 *
 * Business isolation: the target clinic must belong to the authenticated
 * business (business id comes from the JWT, never from the body). The same
 * date can be an off-day for other clinics — only a duplicate for THIS
 * clinic is rejected (UNIQUE clinic_id + off_date).
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "off_days");
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

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateOffDay({
      clinicId: raw.clinicId,
      offDate: raw.offDate,
      reason: raw.reason,
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

    await ensureClinicOffDayTable();

    // Business isolation: only clinics owned by the authenticated business.
    const clinic = await pool.query(
      "SELECT id FROM clinic WHERE id = $1 AND business_id = $2",
      [v.clinicId, auth.user.business_id]
    );
    if ((clinic.rowCount ?? 0) === 0) {
      return NextResponse.json(
        {
          data: { errors: { clinicId: "Clinic not found." } },
          error: "Clinic not found",
          success: false,
          message: "Clinic not found.",
        },
        { status: 400 }
      );
    }

    // Conflict guard: a date can never be BOTH closed (off-day) and a
    // special-hours override for the same clinic.
    await ensureClinicSpecialScheduleTable();
    const special = await pool.query(
      "SELECT 1 FROM clinic_special_schedule WHERE clinic_id = $1 AND special_date = $2::date LIMIT 1",
      [v.clinicId, v.offDate]
    );
    if ((special.rowCount ?? 0) > 0) {
      const message =
        "This date already has special hours for this clinic. Remove the special schedule first.";
      return NextResponse.json(
        {
          data: { errors: { offDate: message } },
          error: message,
          success: false,
          message,
        },
        { status: 409 }
      );
    }

    const insert = await pool.query<ClinicOffDay>(
      `INSERT INTO clinic_off_day (clinic_id, off_date, reason)
       VALUES ($1, $2::date, $3)
       RETURNING id, clinic_id, TO_CHAR(off_date, 'YYYY-MM-DD') AS off_date, reason`,
      [v.clinicId, v.offDate, v.reason]
    );

    return envelope(insert.rows[0], "Off-day added.", true, null, 201);
  } catch (err) {
    // Duplicate (clinic, date) — unique violation, mapped without leaking DB errors.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      const message = "This clinic already has an off-day on that date.";
      return NextResponse.json(
        {
          data: { errors: { offDate: message } },
          error: message,
          success: false,
          message,
        },
        { status: 409 }
      );
    }

    console.error("POST /api/off-days failed:", err);
    return envelope(null, "Unable to add off-day", false, "Unable to add off-day", 500);
  }
}
