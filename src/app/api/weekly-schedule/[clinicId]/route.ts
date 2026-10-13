import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { validateWeeklySchedule } from "@/lib/weeklySchedule";
import {
  ensureClinicWeeklyScheduleTable,
  loadWeeklySchedules,
} from "@/lib/weeklyScheduleDb";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ clinicId: string }> };

function fail(message: string, status: number) {
  return NextResponse.json(
    { data: null, error: message, success: false, message },
    { status }
  );
}

/**
 * PATCH /api/weekly-schedule/[clinicId]
 *
 * Updates the weekly schedule of ONE clinic. The path param is the clinic's
 * unique UUID (never the name or city), so similar clinic names can never
 * collide, and changes only ever affect that clinic.
 *
 * Body:
 *   {
 *     days: [
 *       { day: "Monday", isOpen: true, openingTime: "16:00", closingTime: "21:00" },
 *       { day: "Sunday", isOpen: false, openingTime: null, closingTime: null },
 *       ...
 *     ]
 *   }
 *
 * Business isolation: the target clinic must belong to the authenticated
 * business (business id comes from the JWT, never from the body).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "weekly_schedule");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { clinicId } = await params;
    if (!UUID_RE.test(clinicId)) {
      return fail("Invalid clinic id", 400);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateWeeklySchedule(raw.days);
    if (!validated.ok) {
      return fail(validated.error, 400);
    }

    await ensureClinicWeeklyScheduleTable();

    // Business isolation: only clinics owned by the authenticated business.
    const clinic = await pool.query(
      "SELECT id FROM clinic WHERE id = $1 AND business_id = $2",
      [clinicId, auth.user.business_id]
    );
    if ((clinic.rowCount ?? 0) === 0) {
      return fail("Clinic not found", 404);
    }

    // Upsert ONLY this clinic's rows; other clinics are never touched.
    // updated_at acts as the "manually edited" marker (clinic-driven rows
    // keep updated_at = created_at, which is what the clinic-sync refreshes).
    // It is bumped ONLY when this request actually changes a day's value —
    // saving the form without changes keeps the schedule clinic-driven.
    const days = validated.data;
    const values: unknown[] = [clinicId];
    const tuples: string[] = days.map((d) => {
      const base = values.length + 1;
      values.push(d.day, d.isOpen, d.openingTime, d.closingTime);
      return `($1::uuid, $${base}::varchar, $${base + 1}::boolean, $${base + 2}::time, $${base + 3}::time)`;
    });

    await pool.query(
      `INSERT INTO clinic_weekly_schedule
         (clinic_id, day_of_week, is_open, opening_time, closing_time)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (clinic_id, day_of_week)
       DO UPDATE SET is_open = EXCLUDED.is_open,
                     opening_time = EXCLUDED.opening_time,
                     closing_time = EXCLUDED.closing_time,
                     updated_at = CASE
                       WHEN clinic_weekly_schedule.is_open IS DISTINCT FROM EXCLUDED.is_open
                         OR clinic_weekly_schedule.opening_time IS DISTINCT FROM EXCLUDED.opening_time
                         OR clinic_weekly_schedule.closing_time IS DISTINCT FROM EXCLUDED.closing_time
                       THEN NOW()
                       ELSE clinic_weekly_schedule.updated_at
                     END`,
      values
    );

    // Return the updated clinic + its full 7-day schedule (same shape as GET).
    const [item] = await loadWeeklySchedules(auth.user.business_id, clinicId);
    if (!item) {
      return fail("Clinic not found", 404);
    }

    return NextResponse.json(
      {
        data: item,
        error: null,
        success: true,
        message: "Weekly schedule updated.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("PATCH /api/weekly-schedule/[clinicId] failed:", err);
    return fail("Unable to update weekly schedule", 500);
  }
}
