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
import { withSequentialId } from "@/lib/sequentialId";

export const dynamic = "force-dynamic";

/**
 * Maps to the existing `appointment` table:
 *   id, business_id, appointment_id, patient_id, doctor_id, clinic_id,
 *   appointment_date, appointment_time, appointment_type,
 *   status, created_at, updated_at
 *
 * Relationships:
 *   patient_id -> patient(id), doctor_id -> doctor_profiles(id), clinic_id -> clinic(id)
 */

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, error: auth.message, success: false, message: auth.message },
      { status: auth.status }
    );
  }
  if (!auth.user.business_id) {
    return NextResponse.json(
      { data: null, error: "No business", success: false, message: "No business associated with this account." },
      { status: 400 }
    );
  }
  const businessId = auth.user.business_id;

  try {
    const result = await pool.query(
      `${SELECT_WITH_JOINS} WHERE a.business_id = $1 ORDER BY a.created_at DESC`,
      [businessId]
    );
    return NextResponse.json({
      data: result.rows.map(mapAppointment),
      error: null,
      success: true,
      message: "Appointments loaded",
    });
  } catch (error) {
    console.error("GET /api/appointments failed:", error);
    return NextResponse.json(
      { data: null, error: "Server error", success: false, message: "Unable to load appointments." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, error: auth.message, success: false, message: auth.message },
      { status: auth.status }
    );
  }
  if (!auth.user.business_id) {
    return NextResponse.json(
      { data: null, error: "No business", success: false, message: "No business associated with this account." },
      { status: 400 }
    );
  }
  const businessId = auth.user.business_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid JSON", success: false, message: "Invalid request body." },
      { status: 400 }
    );
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  // Validation (shared frontend/backend rules; past dates are new appointments -> rejected).
  const validated = validateAppointment({
    patientId: raw.patientId,
    doctorId: raw.doctorId,
    clinicId: raw.clinicId,
    appointmentDate: raw.appointmentDate,
    appointmentTime: raw.appointmentTime,
    appointmentType: raw.appointmentType,
    status: raw.status,
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

  try {
    // Ownership verification: every referenced record must belong to the same business.
    const owned = await verifyOwnership(businessId, v.patientId, v.doctorId, v.clinicId);
    if (!owned.ok) {
      return NextResponse.json(
        {
          data: { errors: { [owned.field]: owned.message } },
          error: owned.message,
          success: false,
          message: owned.message,
        },
        { status: 400 }
      );
    }

    // Off-day block: a booking can never land on a date the clinic is
    // closed (the off-day belongs to this clinic; ownership was verified
    // above, so the lookup is implicitly business-scoped).
    const offDay = await getClinicOffDayOn(v.clinicId, v.appointmentDate);
    if (offDay) {
      const offDayMessage = offDay.reason
        ? `The clinic is off on this date (${offDay.reason}). Please choose another date.`
        : "The clinic is off on this date. Please choose another date.";
      return NextResponse.json(
        {
          data: { errors: { appointmentDate: offDayMessage } },
          error: "Clinic is off on this date",
          success: false,
          message: offDayMessage,
        },
        { status: 400 }
      );
    }

    // Duplicate slot protection: same doctor + clinic + date + time in this business.
    if (await slotConflict(businessId, v.doctorId, v.clinicId, v.appointmentDate, v.appointmentTime)) {
      return NextResponse.json(
        { data: null, error: "Conflict", success: false, message: "This doctor already has an appointment at this time." },
        { status: 409 }
      );
    }

    // appointment_id (APT-YYYYMMDD-XXXX) is generated on the server from
    // the dedicated appointment_id_sequence (START 5001) inside the SAME
    // transaction as the insert; any appointmentId sent by the frontend is
    // ignored. Patients draw from an INDEPENDENT sequence
    // (patient_id_sequence, START 1), so both ID types can never share the
    // same numeric suffix. If the insert fails, the whole transaction rolls
    // back: never a partial record.
    const insertedId = await withSequentialId("APT", async (appointmentId, client) => {
      const insert = await client.query(
        `INSERT INTO appointment
           (business_id, appointment_id, patient_id, doctor_id, clinic_id,
            appointment_date, appointment_time, appointment_type, status)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::time, $8, $9)
         RETURNING id`,
        [
          businessId,
          appointmentId,
          v.patientId,
          v.doctorId,
          v.clinicId,
          v.appointmentDate,
          v.appointmentTime,
          v.appointmentType,
          v.status,
        ]
      );
      return insert.rows[0].id as string;
    });

    // Re-select with JOINs so the response carries the display data (the
    // transaction has committed, so this read sees the new row).
    const created = await pool.query(`${SELECT_WITH_JOINS} WHERE a.id = $1`, [
      insertedId,
    ]);

    return NextResponse.json(
      {
        data: mapAppointment(created.rows[0]),
        error: null,
        success: true,
        message: "Appointment created successfully.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/appointments failed:", error);
    return NextResponse.json(
      { data: null, error: "Server error", success: false, message: "Unable to save appointment." },
      { status: 500 }
    );
  }
}
