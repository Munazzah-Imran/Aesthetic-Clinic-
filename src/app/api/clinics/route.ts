import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validateClinic } from "@/lib/clinicValidation";
import { seedScheduleFromClinic } from "@/lib/weeklyScheduleDb";

export const dynamic = "force-dynamic";

/**
 * Maps to the existing `clinic` table:
 *   id, business_id, clinic_name, city, city_code, contact_number,
 *   full_clinic_address, working_days, status, google_map_url,
 *   latitude, longitude, created_at, updated_at
 */
type ClinicRow = {
  id: string;
  business_id: string;
  clinic_name: string;
  city: string;
  city_code: string;
  contact_number: string;
  full_clinic_address: string;
  working_days: string;
  opening_time: string;
  closing_time: string;
  status: string;
  google_map_url: string | null;
  latitude: string | null;
  longitude: string | null;
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

    // Business isolation: only clinics belonging to the authenticated business.
    const result = await pool.query<ClinicRow>(
      "SELECT * FROM clinic WHERE business_id = $1 ORDER BY created_at DESC",
      [auth.user.business_id]
    );

    return envelope(result.rows, "Clinics loaded");
  } catch (err) {
    console.error("GET /api/clinics failed:", err);
    return envelope(
      null,
      "Unable to load clinics",
      false,
      "Unable to load clinics",
      500
    );
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
    const validated = validateClinic({
      clinicName: raw.clinicName,
      city: raw.city,
      cityCode: raw.cityCode,
      contactNumber: raw.contactNumber,
      fullClinicAddress: raw.fullClinicAddress,
      workingDays: raw.workingDays,
      openingTime: raw.openingTime,
      closingTime: raw.closingTime,
      status: raw.status,
      googleMapUrl: raw.googleMapUrl,
      latitude: raw.latitude,
      longitude: raw.longitude,
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

    // business_id ALWAYS comes from the JWT/authenticated user — never the body.
    // Optional fields (google_map_url, latitude, longitude) arrive as SQL NULL
    // when left empty; the validator guarantees null instead of "".
    const result = await pool.query<ClinicRow>(
      `INSERT INTO clinic (
        business_id,
        clinic_name,
        city,
        city_code,
        contact_number,
        full_clinic_address,
        working_days,
        opening_time,
        closing_time,
        status,
        google_map_url,
        latitude,
        longitude
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        auth.user.business_id,
        v.clinicName,
        v.city,
        v.cityCode,
        v.contactNumber,
        v.fullClinicAddress,
        v.workingDays,
        v.openingTime,
        v.closingTime,
        v.status,
        v.googleMapUrl,
        v.latitude,
        v.longitude,
      ]
    );

    const newClinic = result.rows[0];

    // Weekly Schedule integration: the new clinic's schedule is derived
    // from the working days + hours the admin just entered (never invented
    // hours — missing times keep every day Closed). Existing schedules are
    // never overwritten (ON CONFLICT DO NOTHING), and a schedule failure
    // never blocks creating the clinic itself.
    try {
      await seedScheduleFromClinic(newClinic.id, {
        workingDays: v.workingDays,
        openingTime: v.openingTime,
        closingTime: v.closingTime,
      });
    } catch (scheduleErr) {
      console.error("Weekly schedule seeding failed:", scheduleErr);
    }

    return envelope(newClinic, "Clinic added successfully.", true, null, 201);
  } catch (err) {
    // Map unique/conflict violations to 409 without leaking raw DB errors.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return envelope(
        null,
        "A clinic with these details already exists.",
        false,
        "A clinic with these details already exists.",
        409
      );
    }

    console.error("POST /api/clinics failed:", err);
    return envelope(null, "Unable to add clinic", false, "Unable to add clinic", 500);
  }
}
