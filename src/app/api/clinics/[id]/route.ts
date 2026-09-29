import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validateClinic } from "@/lib/clinicValidation";
import { syncScheduleWithClinic } from "@/lib/weeklyScheduleDb";

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

type Params = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
  return NextResponse.json(
    { data: null, error: message, success: false, message },
    { status }
  );
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid clinic id", 400);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

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

    // Business isolation: WHERE id = $1 AND business_id = $2 (business_id from auth).
    const result = await pool.query<ClinicRow>(
      `UPDATE clinic SET
        clinic_name = $3,
        city = $4,
        city_code = $5,
        contact_number = $6,
        full_clinic_address = $7,
        working_days = $8,
        opening_time = $9,
        closing_time = $10,
        status = $11,
        google_map_url = $12,
        latitude = $13,
        longitude = $14,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [
        id,
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
    if (result.rowCount === 0) {
      return fail("Clinic not found", 404);
    }

    // Weekly Schedule integration: keep this clinic's schedule in sync with
    // the working days / hours just saved. Days the admin already configured
    // directly in Weekly Schedule are left untouched (manual edits win);
    // everything else follows the clinic record. A sync failure never blocks
    // the clinic update itself.
    try {
      await syncScheduleWithClinic(id, {
        workingDays: v.workingDays,
        openingTime: v.openingTime,
        closingTime: v.closingTime,
      });
    } catch (scheduleErr) {
      console.error("Weekly schedule sync failed:", scheduleErr);
    }

    return NextResponse.json(
      {
        data: result.rows[0],
        error: null,
        success: true,
        message: "Clinic updated successfully.",
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
      return fail("A clinic with these details already exists.", 409);
    }

    console.error("PATCH /api/clinics/[id] failed:", err);
    return fail("Unable to update clinic", 500);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid clinic id", 400);
    }

    // Business isolation: only delete clinics owned by the authenticated business.
    const result = await pool.query(
      "DELETE FROM clinic WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, auth.user.business_id]
    );
    if (result.rowCount === 0) {
      return fail("Clinic not found", 404);
    }

    return NextResponse.json(
      {
        data: { id },
        error: null,
        success: true,
        message: "Clinic deleted successfully.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /api/clinics/[id] failed:", err);
    return fail("Unable to delete clinic", 500);
  }
}
