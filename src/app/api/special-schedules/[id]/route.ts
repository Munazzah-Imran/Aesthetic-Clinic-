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
} from "@/lib/specialSchedulesDb";

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

function conflict(message: string) {
  return NextResponse.json(
    {
      data: { errors: { specialDate: message } },
      error: message,
      success: false,
      message,
    },
    { status: 409 }
  );
}

/**
 * PATCH /api/special-schedules/[id]
 *
 * Updates ONE special schedule (date, times, reason). Business isolation
 * happens THROUGH the owning clinic: the row only matches when its clinic
 * belongs to the authenticated business. Other clinics are never touched.
 *
 * Full-update semantics (like PATCH /api/clinics/[id]): the body carries
 * all fields.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid special schedule id", 400);
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

    // Ownership: the row must exist AND belong to this business's clinic.
    const existing = await pool.query(
      `SELECT s.id, s.clinic_id
         FROM clinic_special_schedule s
         JOIN clinic c ON c.id = s.clinic_id
        WHERE s.id = $1 AND c.business_id = $2
        LIMIT 1`,
      [id, auth.user.business_id]
    );
    if ((existing.rowCount ?? 0) === 0) {
      return fail("Special schedule not found", 404);
    }

    // The payload's clinic must also belong to this business.
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

    // Conflict guard: a date can never be both special hours and an off-day.
    if (await hasOffDayOn(v.clinicId, v.specialDate)) {
      return conflict(
        "This date is already an off-day for this clinic. Remove the off-day first."
      );
    }

    const updated = await pool.query<ClinicSpecialSchedule>(
      `UPDATE clinic_special_schedule SET
         clinic_id = $3,
         special_date = $4::date,
         opening_time = $5::time,
         closing_time = $6::time,
         reason = $7,
         updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, clinic_id,
                 TO_CHAR(special_date, 'YYYY-MM-DD') AS special_date,
                 TO_CHAR(opening_time, 'HH24:MI') AS opening_time,
                 TO_CHAR(closing_time, 'HH24:MI') AS closing_time,
                 reason`,
      [id, existing.rows[0].clinic_id, v.clinicId, v.specialDate, v.openingTime, v.closingTime, v.reason]
    );

    return NextResponse.json(
      {
        data: updated.rows[0],
        error: null,
        success: true,
        message: "Special schedule updated.",
      },
      { status: 200 }
    );
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return conflict("This clinic already has a special schedule on that date.");
    }

    console.error("PATCH /api/special-schedules/[id] failed:", err);
    return fail("Unable to update special schedule", 500);
  }
}

/**
 * DELETE /api/special-schedules/[id]
 *
 * Removes ONE special schedule. Business isolation happens THROUGH the
 * owning clinic, so another business's entry can never be deleted and
 * other clinics' entries are unaffected.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid special schedule id", 400);
    }

    await ensureClinicSpecialScheduleTable();

    const result = await pool.query(
      `DELETE FROM clinic_special_schedule s
        USING clinic c
        WHERE s.id = $1
          AND s.clinic_id = c.id
          AND c.business_id = $2
        RETURNING s.id`,
      [id, auth.user.business_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      return fail("Special schedule not found", 404);
    }

    return NextResponse.json(
      {
        data: { id },
        error: null,
        success: true,
        message: "Special schedule removed.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /api/special-schedules/[id] failed:", err);
    return fail("Unable to remove special schedule", 500);
  }
}
