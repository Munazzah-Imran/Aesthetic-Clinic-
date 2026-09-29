import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validateDoctor } from "@/lib/doctorValidation";

export const dynamic = "force-dynamic";

type DoctorRow = {
  id: string;
  business_id: string;
  full_name: string;
  specialty: string | null;
  professional_title: string | null;
  status: string;
  consultation_days: string | null;
  consultation_start_time: string | null;
  consultation_end_time: string | null;
  created_at: string;
  updated_at: string;
};

function mapDoctor(row: DoctorRow) {
  return {
    id: row.id,
    businessId: row.business_id,
    fullName: row.full_name,
    specialty: row.specialty,
    professionalTitle: row.professional_title,
    status: row.status,
    consultationDays: row.consultation_days,
    consultationStartTime: typeof row.consultation_start_time === "string" ? row.consultation_start_time.slice(0, 5) : row.consultation_start_time,
    consultationEndTime: typeof row.consultation_end_time === "string" ? row.consultation_end_time.slice(0, 5) : row.consultation_end_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

function envelope(data: unknown, message: string, success = true, error: string | null = null, status = 200) {
  return NextResponse.json({ data, error, success, message }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    const { id } = await context.params;
    const result = await pool.query<DoctorRow>(
      "SELECT * FROM doctor WHERE id = $1 AND business_id = $2 LIMIT 1",
      [id, auth.user.business_id]
    );
    if (!result.rows[0]) {
      return envelope(null, "Doctor not found", false, "Doctor not found", 404);
    }
    return envelope(mapDoctor(result.rows[0]), "Doctor loaded");
  } catch (err) {
    console.error("GET /api/doctors/[id] failed:", err);
    return envelope(null, "Unable to load doctor", false, "Unable to load doctor", 500);
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

    const existing = await pool.query(
      "SELECT id FROM doctor WHERE id = $1 AND business_id = $2 LIMIT 1",
      [id, businessId]
    );
    if (!existing.rows[0]) {
      return envelope(null, "Doctor not found", false, "Doctor not found", 404);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateDoctor({
      fullName: raw.fullName,
      specialty: raw.specialty,
      professionalTitle: raw.professionalTitle,
      status: raw.status,
      consultationDays: raw.consultationDays,
      consultationStartTime: raw.consultationStartTime,
      consultationEndTime: raw.consultationEndTime,
    });
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

    // Duplicate name guard, excluding this doctor.
    const dupe = await pool.query(
      "SELECT 1 FROM doctor WHERE business_id = $1 AND LOWER(full_name) = LOWER($2) AND id != $3 LIMIT 1",
      [businessId, v.fullName, id]
    );
    if (dupe.rows.length > 0) {
      return envelope(
        { errors: { fullName: "A doctor with this name already exists." } },
        "A doctor with this name already exists.",
        false,
        "Duplicate doctor",
        409
      );
    }

    const updated = await pool.query<DoctorRow>(
      `UPDATE doctor SET
        full_name = $1, specialty = $2, professional_title = $3, status = $4,
        consultation_days = $5,
        consultation_start_time = $6::time,
        consultation_end_time = $7::time,
        updated_at = NOW()
      WHERE id = $8 AND business_id = $9
      RETURNING *`,
      [v.fullName, v.specialty, v.professionalTitle, v.status,
       v.consultationDays, v.consultationStartTime, v.consultationEndTime,
       id, businessId]
    );

    if (!updated.rows[0]) {
      return envelope(null, "Doctor not found", false, "Doctor not found", 404);
    }

    return envelope(mapDoctor(updated.rows[0]), "Doctor updated successfully.");
  } catch (err) {
    console.error("PATCH /api/doctors/[id] failed:", err);
    return envelope(null, "Unable to save doctor", false, "Unable to save doctor", 500);
  }
}

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

    const result = await pool.query(
      "DELETE FROM doctor WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, auth.user.business_id]
    );
    if (!result.rows[0]) {
      return envelope(null, "Doctor not found", false, "Doctor not found", 404);
    }

    return envelope({ id: result.rows[0].id }, "Doctor deleted successfully.");
  } catch (err) {
    console.error("DELETE /api/doctors/[id] failed:", err);
    return envelope(null, "Unable to delete doctor", false, "Unable to delete doctor", 500);
  }
}
