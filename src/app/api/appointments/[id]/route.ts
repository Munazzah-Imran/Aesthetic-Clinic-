import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  mapAppointment,
  SELECT_WITH_JOINS,
  verifyOwnership,
  slotConflict,
} from "@/lib/appointmentsShared";
import { validateAppointment } from "@/lib/appointmentValidation";
import { getClinicOffDayOn } from "@/lib/offDaysDb";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function envelope(
  data: unknown,
  message: string,
  success = true,
  error: string | null = null,
  status = 200
) {
  return NextResponse.json({ data, error, success, message }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }

    const { id } = await context.params;
    const result = await pool.query(
      `${SELECT_WITH_JOINS} WHERE a.id = $1 AND a.business_id = $2 LIMIT 1`,
      [id, auth.user.business_id]
    );
    if (!result.rows[0]) {
      return envelope(null, "Appointment not found", false, "Appointment not found", 404);
    }

    return envelope(mapAppointment(result.rows[0]), "Appointment loaded");
  } catch (err) {
    console.error("GET /api/appointments/[id] failed:", err);
    return envelope(null, "Unable to load appointment", false, "Unable to load appointment", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }
    const businessId = auth.user.business_id;

    const { id } = await context.params;

    // Ownership first: the appointment must belong to this business.
    // The current clinic/date are loaded so the off-day check below can tell
    // an untouched date apart from a move onto a closed day.
    const existing = await pool.query(
      `SELECT id, clinic_id, TO_CHAR(appointment_date, 'YYYY-MM-DD') AS appointment_date
         FROM appointment WHERE id = $1 AND business_id = $2 LIMIT 1`,
      [id, businessId]
    );
    if (!existing.rows[0]) {
      return envelope(null, "Appointment not found", false, "Appointment not found", 404);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    // allowPastDates: editing an existing record must stay possible even if
    // its date has already passed (e.g. marking it completed).
    const validated = validateAppointment(
      {
        patientId: raw.patientId,
        doctorId: raw.doctorId,
        clinicId: raw.clinicId,
        appointmentDate: raw.appointmentDate,
        appointmentTime: raw.appointmentTime,
        appointmentType: raw.appointmentType,
        status: raw.status,
      },
      { allowPastDates: true }
    );
    if (!validated.ok) {
      return envelope(
        { errors: validated.errors },
        "Please fix the highlighted fields.",
        false,
        "Validation failed",
        400
      );
    }

    const v = validated.data;

    // Relations must belong to this business (IDs never trusted).
    const owned = await verifyOwnership(businessId, v.patientId, v.doctorId, v.clinicId);
    if (!owned.ok) {
      return envelope(
        { errors: { [owned.field]: owned.message } },
        owned.message,
        false,
        owned.message,
        400
      );
    }

    // Off-day block: an appointment may never be MOVED onto a date the
    // clinic is closed. An appointment already sitting on a date that was
    // later marked off stays editable (so it can be cancelled/rescheduled
    // off that date — blocking it would trap the record).
    const movesOntoOffDay =
      v.clinicId !== existing.rows[0].clinic_id ||
      v.appointmentDate !== existing.rows[0].appointment_date;
    if (movesOntoOffDay) {
      const offDay = await getClinicOffDayOn(v.clinicId, v.appointmentDate);
      if (offDay) {
        const offDayMessage = offDay.reason
          ? `The clinic is off on this date (${offDay.reason}). Please choose another date.`
          : "The clinic is off on this date. Please choose another date.";
        return envelope(
          { errors: { appointmentDate: offDayMessage } },
          offDayMessage,
          false,
          "Clinic is off on this date",
          400
        );
      }
    }

    // Slot conflict check, excluding the appointment being updated.
    if (await slotConflict(businessId, v.doctorId, v.clinicId, v.appointmentDate, v.appointmentTime, id)) {
      return envelope(
        null,
        "This doctor already has an appointment at this time.",
        false,
        "Doctor is already booked at this time.",
        409
      );
    }

    // appointment_id and business_id are never editable from the frontend.
    const updated = await pool.query(
      `UPDATE appointment SET
        patient_id = $1, doctor_id = $2, clinic_id = $3,
        appointment_date = $4::date, appointment_time = $5::time,
        appointment_type = $6, status = $7,
        updated_at = NOW()
      WHERE id = $8 AND business_id = $9
      RETURNING id`,
      [
        v.patientId,
        v.doctorId,
        v.clinicId,
        v.appointmentDate,
        v.appointmentTime,
        v.appointmentType,
        v.status,
        id,
        businessId,
      ]
    );

    if (!updated.rows[0]) {
      return envelope(null, "Appointment not found", false, "Appointment not found", 404);
    }

    // Re-select with JOINs so the response carries the display data.
    const fresh = await pool.query(
      `${SELECT_WITH_JOINS} WHERE a.id = $1 AND a.business_id = $2 LIMIT 1`,
      [id, businessId]
    );

    return envelope(mapAppointment(fresh.rows[0]), "Appointment updated successfully.");
  } catch (err) {
    console.error("PATCH /api/appointments/[id] failed:", err);
    return envelope(null, "Unable to save appointment", false, "Unable to save appointment", 500);
  }
}

/**
 * DELETE — the normal workflow is cancellation (PATCH status), but permanent
 * deletion is supported for records created by mistake.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }

    const { id } = await context.params;

    // Ownership scoped delete: another business's appointment can never match.
    const result = await pool.query(
      "DELETE FROM appointment WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, auth.user.business_id]
    );

    if (!result.rows[0]) {
      return envelope(null, "Appointment not found", false, "Appointment not found", 404);
    }

    return envelope({ id: result.rows[0].id }, "Appointment deleted successfully.");
  } catch (err) {
    console.error("DELETE /api/appointments/[id] failed:", err);
    return envelope(null, "Unable to delete appointment", false, "Unable to delete appointment", 500);
  }
}
