import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validatePatient } from "@/lib/patientValidation";
import { withSequentialId } from "@/lib/sequentialId";

export const dynamic = "force-dynamic";

/**
 * Maps to the `patient` table:
 *   id, business_id, patient_id, full_name, gender, date_of_birth, age,
 *   marital_status, phone, alternate_phone, email, full_address,
 *   city, emergency_contact_*, status, created_at, updated_at
 *
 * Required (API + validation layer): full_name, gender, age, city, phone,
 * date_of_birth, marital_status. Everything else is optional (SQL NULL).
 * Legacy medical columns still exist in the DB but are no longer written.
 */
type PatientRow = {
  id: string;
  business_id: string;
  patient_id: string;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  age: number | null;
  marital_status: string | null;
  phone: string | null;
  alternate_phone: string | null;
  email: string | null;
  full_address: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

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

    // Business isolation: only patients belonging to the authenticated business.
    const result = await pool.query<PatientRow>(
      "SELECT * FROM patient WHERE business_id = $1 ORDER BY created_at DESC",
      [auth.user.business_id]
    );

    return envelope(result.rows, "Patients loaded");
  } catch (err) {
    console.error("GET /api/patients failed:", err);
    return envelope(null, "Unable to load patients", false, "Unable to load patients", 500);
  }
}

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

    // Server-side validation (never trust the frontend).
    const validated = validatePatient({
      fullName: raw.fullName,
      gender: raw.gender,
      age: raw.age,
      dateOfBirth: raw.dateOfBirth,
      maritalStatus: raw.maritalStatus,
      phone: raw.phone,
      alternatePhone: raw.alternatePhone,
      email: raw.email,
      fullAddress: raw.fullAddress,
      city: raw.city,
      emergencyContactName: raw.emergencyContactName,
      emergencyContactRelationship: raw.emergencyContactRelationship,
      emergencyContactPhone: raw.emergencyContactPhone,
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
    const businessId = auth.user.business_id;

    // business_id ALWAYS comes from the JWT — never the request body.
    // patient_id (PT-YYYYMMDD-XXXX) is generated on the server from the
    // dedicated patient_id_sequence (START 1) inside the SAME transaction as
    // the insert; any patientId sent by the frontend is ignored. Appointments
    // draw from an INDEPENDENT sequence (appointment_id_sequence, START 5001),
    // so both ID types can never share the same numeric suffix. Optional
    // fields arrive as SQL NULL when empty.
    const created = await withSequentialId("PT", async (patientId, client) => {
      const result = await client.query<PatientRow>(
        `INSERT INTO patient (
          business_id, patient_id, full_name, gender, date_of_birth,
          age, marital_status, phone, alternate_phone, email,
          full_address, city, emergency_contact_name,
          emergency_contact_relationship, emergency_contact_phone, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *`,
        [
          businessId,
          patientId,
          v.fullName,
          v.gender,
          v.dateOfBirth,
          v.age,
          v.maritalStatus,
          v.phone,
          v.alternatePhone,
          v.email,
          v.fullAddress,
          v.city,
          v.emergencyContactName,
          v.emergencyContactRelationship,
          v.emergencyContactPhone,
          v.status,
        ]
      );
      return result.rows[0];
    });

    return envelope(created, "Patient created successfully.", true, null, 201);
  } catch (err) {
    console.error("POST /api/patients failed:", err);
    return envelope(null, "Unable to save patient", false, "Unable to save patient", 500);
  }
}
