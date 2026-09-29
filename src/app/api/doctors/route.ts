import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validateDoctor } from "@/lib/doctorValidation";

export const dynamic = "force-dynamic";

/**
 * Maps to the `doctor` table (one row per doctor, per business):
 *   id, business_id, full_name, specialty, professional_title,
 *   status, created_at, updated_at
 */

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

  try {
    const result = await pool.query<DoctorRow>(
      "SELECT * FROM doctor WHERE business_id = $1 ORDER BY created_at DESC",
      [auth.user.business_id]
    );
    return NextResponse.json({
      data: result.rows.map(mapDoctor),
      error: null,
      success: true,
      message: "Doctors loaded",
    });
  } catch (error) {
    console.error("GET /api/doctors failed:", error);
    return NextResponse.json(
      { data: null, error: "Server error", success: false, message: "Unable to load doctors." },
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
    // Duplicate name guard (unique constraint is business-scoped).
    const dupe = await pool.query(
      "SELECT 1 FROM doctor WHERE business_id = $1 AND LOWER(full_name) = LOWER($2) LIMIT 1",
      [businessId, v.fullName]
    );
    if (dupe.rows.length > 0) {
      return NextResponse.json(
        {
          data: { errors: { fullName: "A doctor with this name already exists." } },
          error: "Duplicate doctor",
          success: false,
          message: "A doctor with this name already exists.",
        },
        { status: 409 }
      );
    }

    const insert = await pool.query<DoctorRow>(
      `INSERT INTO doctor (business_id, full_name, specialty, professional_title, status,
         consultation_days, consultation_start_time, consultation_end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time)
       RETURNING *`,
      [businessId, v.fullName, v.specialty, v.professionalTitle, v.status,
       v.consultationDays, v.consultationStartTime, v.consultationEndTime]
    );

    return NextResponse.json(
      {
        data: mapDoctor(insert.rows[0]),
        error: null,
        success: true,
        message: "Doctor added successfully.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/doctors failed:", error);
    return NextResponse.json(
      { data: null, error: "Server error", success: false, message: "Unable to save doctor." },
      { status: 500 }
    );
  }
}
