import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  validateSpecialSchedule,
  type ClinicSpecialSchedule,
} from "@/lib/specialSchedules";
import {
  ensureClinicSpecialScheduleTable,
  hasOffDayOn,
  loadSpecialSchedulesByClinic,
} from "@/lib/specialSchedulesDb";

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

function conflict(message: string, field: "specialDate") {
  return NextResponse.json(
    {
      data: { errors: { [field]: message } },
      error: message,
      success: false,
      message,
    },
    { status: 409 }
  );
}

/**
 * GET /api/special-schedules
 *
 * Returns EVERY clinic of the authenticated business together with its
 * one-off schedule overrides (dates on which the clinic opens with
 * different hours than its Weekly Schedule):
 *
 *   {
 *     success: true,
 *     data: [
 *       {
 *         clinic: { id, clinic_name, city, status },
 *         specials: [
 *           { id, clinic_id, special_date: "2026-12-24",
 *             opening_time: "10:00", closing_time: "14:00", reason: "..." }
 *         ]
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
    const auth = await requireAuth(request);
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

    const data = await loadSpecialSchedulesByClinic(auth.user.business_id);

    return envelope(data, "Special schedules loaded");
  } catch (err) {
    console.error("GET /api/special-schedules failed:", err);
    return envelope(
      null,
      "Unable to load special schedules",
      false,
      "Unable to load special schedules",
      500
    );
  }
}

/**
 * POST /api/special-schedules
 *
 * Creates one one-off override for ONE clinic.
 *
 * Body: { clinicId, specialDate: "YYYY-MM-DD", openingTime, closingTime,
 *         reason? }
 *
 * Business isolation: the target clinic must belong to the authenticated
 * business (business id comes from the JWT, never from the body).
 * A date cannot be BOTH a special-hours override and an off-day for the
 * same clinic — contradictions are rejected.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
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

    const validated = validateSpecialSchedule({
      clinicId: raw.clinicId,
      specialDate: raw.specialDate,
      openingTime: raw.openingTime,
      closingTime: raw.closingTime,
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

    await ensureClinicSpecialScheduleTable();

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

    // Conflict guard: this date is already an off-day (closed) for the clinic.
    if (await hasOffDayOn(v.clinicId, v.specialDate)) {
      return conflict(
        "This date is already an off-day for this clinic. Remove the off-day first.",
        "specialDate"
      );
    }

    const insert = await pool.query<ClinicSpecialSchedule>(
      `INSERT INTO clinic_special_schedule
         (clinic_id, special_date, opening_time, closing_time, reason)
       VALUES ($1, $2::date, $3::time, $4::time, $5)
       RETURNING id, clinic_id,
                 TO_CHAR(special_date, 'YYYY-MM-DD') AS special_date,
                 TO_CHAR(opening_time, 'HH24:MI') AS opening_time,
                 TO_CHAR(closing_time, 'HH24:MI') AS closing_time,
                 reason`,
      [v.clinicId, v.specialDate, v.openingTime, v.closingTime, v.reason]
    );

    return envelope(insert.rows[0], "Special schedule added.", true, null, 201);
  } catch (err) {
    // Duplicate (clinic, date) — unique violation, mapped without leaking DB errors.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return conflict(
        "This clinic already has a special schedule on that date.",
        "specialDate"
      );
    }

    console.error("POST /api/special-schedules failed:", err);
    return envelope(
      null,
      "Unable to add special schedule",
      false,
      "Unable to add special schedule",
      500
    );
  }
}
