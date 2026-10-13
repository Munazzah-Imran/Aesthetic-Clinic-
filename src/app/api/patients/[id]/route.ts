import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission, PATIENT_READERS } from "@/lib/rbac";
import { validatePatient } from "@/lib/patientValidation";

export const dynamic = "force-dynamic";

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

type RouteContext = { params: Promise<{ id: string }> };

/** Fetch one patient scoped to the authenticated business (isolation). */
async function loadOwnedPatient(id: string, businessId: string) {
  const result = await pool.query<PatientRow>(
    "SELECT * FROM patient WHERE id = $1 AND business_id = $2 LIMIT 1",
    [id, businessId]
  );
  return result.rows[0] ?? null;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requirePermission(request, PATIENT_READERS);
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }

    const { id } = await context.params;
    const patient = await loadOwnedPatient(id, auth.user.business_id);
    if (!patient) {
      return envelope(null, "Patient not found", false, "Patient not found", 404);
    }

    return envelope(patient, "Patient loaded");
  } catch (err) {
    console.error("GET /api/patients/[id] failed:", err);
    return envelope(null, "Unable to load patient", false, "Unable to load patient", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requirePermission(request, "patients");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }

    const { id } = await context.params;

    // Ownership first: the patient must belong to this business.
    const existing = await loadOwnedPatient(id, auth.user.business_id);
    if (!existing) {
      return envelope(null, "Patient not found", false, "Patient not found", 404);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

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

    // patient_id and business_id are never editable from the frontend.
    // Legacy medical columns are intentionally left untouched (never nulled
    // out) so no existing data is lost by an edit.
    const result = await pool.query<PatientRow>(
      `UPDATE patient SET
        full_name = $1, gender = $2, date_of_birth = $3,
        age = $4, marital_status = $5,
        phone = $6, alternate_phone = $7, email = $8,
        full_address = $9, city = $10,
        emergency_contact_name = $11, emergency_contact_relationship = $12,
        emergency_contact_phone = $13, status = $14,
        updated_at = NOW()
      WHERE id = $15 AND business_id = $16
      RETURNING *`,
      [
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
        id,
        auth.user.business_id,
      ]
    );

    if (!result.rows[0]) {
      return envelope(null, "Patient not found", false, "Patient not found", 404);
    }

    return envelope(result.rows[0], "Patient updated successfully.");
  } catch (err) {
    console.error("PATCH /api/patients/[id] failed:", err);
    return envelope(null, "Unable to save patient", false, "Unable to save patient", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requirePermission(request, "patients");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(null, "No business associated with this account", false, "No business associated with this account", 400);
    }

    const { id } = await context.params;

    // Ownership scoped delete: a patient of another business can never match.
    const result = await pool.query<PatientRow>(
      "DELETE FROM patient WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, auth.user.business_id]
    );

    if (!result.rows[0]) {
      return envelope(null, "Patient not found", false, "Patient not found", 404);
    }

    return envelope({ id: result.rows[0].id }, "Patient deleted successfully.");
  } catch (err) {
    console.error("DELETE /api/patients/[id] failed:", err);
    return envelope(null, "Unable to delete patient", false, "Unable to delete patient", 500);
  }
}
