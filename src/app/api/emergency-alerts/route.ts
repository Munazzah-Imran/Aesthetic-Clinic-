import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { mapAlert, validateAlert } from "@/lib/emergencyAlerts";
import {
  ensureEmergencyAlertTable,
  loadAlert,
  loadAlerts,
} from "@/lib/emergencyAlertsDb";
import { withSequentialId } from "@/lib/sequentialId";

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
 * GET /api/emergency-alerts
 *
 * Returns every emergency alert of the authenticated business (newest
 * first), joined with the EXISTING patient (name/phone) and, when linked,
 * the appointment and clinic.
 *
 * Business isolation: the business id comes from the authenticated user
 * (JWT -> users.business_id), never from the request.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "emergency_alerts");
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

    const rows = await loadAlerts(auth.user.business_id);
    return envelope(rows.map(mapAlert), "Alerts loaded");
  } catch (err) {
    console.error("GET /api/emergency-alerts failed:", err);
    return envelope(
      null,
      "Unable to load emergency alerts",
      false,
      "Unable to load emergency alerts",
      500
    );
  }
}

/**
 * POST /api/emergency-alerts
 *
 * Records ONE emergency alert for the authenticated business.
 *
 * Body: { patientId?, priority, message, appointmentId?, clinicId? }
 *   - patientId is OPTIONAL (an alert does not have to be patient-specific);
 *     when given it MUST reference an existing patient of THIS business —
 *     the patient is reused, never duplicated.
 *   - appointmentId / clinicId are optional and must belong to this
 *     business. Nothing is created when they are not provided.
 *
 * alert_id (ALR-YYYYMMDD-NNNN) is generated on the SERVER from the
 * emergency_alert_id_sequence inside the SAME transaction as the insert —
 * the client can never choose it and it never reuses a patient,
 * appointment, report or consultation ID. business_id always comes from
 * the JWT.
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "emergency_alerts");
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
    const businessId = auth.user.business_id;

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateAlert({
      patientId: raw.patientId,
      priority: raw.priority,
      message: raw.message,
      appointmentId: raw.appointmentId,
      clinicId: raw.clinicId,
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

    await ensureEmergencyAlertTable();

    // Ownership: the referenced patient must belong to this business (IDs
    // arriving from the frontend are never trusted). The EXISTING patient
    // row is used — no patient record is ever created here.
    if (v.patientId) {
      const patient = await pool.query(
        "SELECT 1 FROM patient WHERE id = $1 AND business_id = $2 LIMIT 1",
        [v.patientId, businessId]
      );
      if ((patient.rowCount ?? 0) === 0) {
        return NextResponse.json(
          {
            data: { errors: { patientId: "Selected patient does not belong to your business." } },
            error: "Validation failed",
            success: false,
            message: "Selected patient does not belong to your business.",
          },
          { status: 400 }
        );
      }
    }

    // Optional appointment link: must belong to this business and, when a
    // patient is also selected, must belong to that same patient —
    // otherwise the alert would point at someone else's booking.
    if (v.appointmentId) {
      const appointment = await pool.query(
        v.patientId
          ? "SELECT 1 FROM appointment WHERE id = $1 AND business_id = $2 AND patient_id = $3 LIMIT 1"
          : "SELECT 1 FROM appointment WHERE id = $1 AND business_id = $2 LIMIT 1",
        v.patientId
          ? [v.appointmentId, businessId, v.patientId]
          : [v.appointmentId, businessId]
      );
      if ((appointment.rowCount ?? 0) === 0) {
        return NextResponse.json(
          {
            data: {
              errors: {
                appointmentId: v.patientId
                  ? "Selected appointment does not belong to this patient."
                  : "Selected appointment does not belong to your business.",
              },
            },
            error: "Validation failed",
            success: false,
            message: "Selected appointment does not belong to this patient.",
          },
          { status: 400 }
        );
      }
    }

    // Optional clinic link: must belong to this business.
    if (v.clinicId) {
      const clinic = await pool.query(
        "SELECT 1 FROM clinic WHERE id = $1 AND business_id = $2 LIMIT 1",
        [v.clinicId, businessId]
      );
      if ((clinic.rowCount ?? 0) === 0) {
        return NextResponse.json(
          {
            data: { errors: { clinicId: "Selected clinic does not belong to your business." } },
            error: "Validation failed",
            success: false,
            message: "Selected clinic does not belong to your business.",
          },
          { status: 400 }
        );
      }
    }

    const alertUuid = randomUUID();

    await withSequentialId("ALR", async (alertId, client) => {
      await client.query(
        `INSERT INTO emergency_alert
           (id, business_id, patient_id, appointment_id, clinic_id, alert_id,
            priority, alert_message, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new')`,
        [
          alertUuid,
          businessId,
          v.patientId,
          v.appointmentId,
          v.clinicId,
          alertId,
          v.priority,
          v.message,
        ]
      );
    });

    const row = await loadAlert(businessId, alertUuid);
    if (!row) {
      return envelope(null, "Unable to add alert", false, "Unable to add alert", 500);
    }

    return envelope(mapAlert(row), "Emergency alert recorded.", true, null, 201);
  } catch (err) {
    console.error("POST /api/emergency-alerts failed:", err);
    return envelope(
      null,
      "Unable to create emergency alert",
      false,
      "Unable to create emergency alert",
      500
    );
  }
}
