import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission, DOCTOR_READERS } from "@/lib/rbac";
import {
  validateDoctorProfile,
  MAX_PHOTO_DATA_URL_LENGTH,
  type DoctorProfileInput,
} from "@/lib/doctorValidation";

export const dynamic = "force-dynamic";

/**
 * Per-doctor detailed profile (doctor_profiles table, doctor_id column).
 *
 *   GET   /api/doctors/[id]/profile — load this doctor's detailed profile
 *   PUT   /api/doctors/[id]/profile — create/update it (upsert)
 *
 * The doctor must belong to the authenticated business; business_id always
 * comes from the JWT, never from the frontend.
 */

type ProfileRow = {
  doctor_id: string;
  photo_url: string | null;
  full_name: string;
  professional_title: string | null;
  specialty: string | null;
  experience: string | null;
  qualifications: string | null;
  additional_qualifications: string | null;
  short_bio: string | null;
  full_bio: string | null;
  professional_interests: string | null;
  areas_of_expertise: string | null;
  phone: string | null;
  email: string | null;
  languages: string | null;
  updated_at: string;
};

type RouteContext = { params: Promise<{ id: string }> };

function ok(data: unknown, message: string) {
  return NextResponse.json({ success: true, data, error: null, message });
}

function fail(status: number, message: string) {
  return NextResponse.json({ success: false, data: null, error: message, message }, { status });
}

/** Identity columns the Doctor form owns (doctor table). */
type DoctorIdentity = {
  id: string;
  full_name: string;
  professional_title: string | null;
  specialty: string | null;
};

/**
 * Both handlers share this: resolve the business-owned doctor or fail.
 * The identity columns ride along so GET can fall back to them — full name,
 * title and specialty are entered on the Doctor form (doctor table) and a
 * profile row may never have snapshotted them.
 */
async function loadOwnedDoctor(
  doctorId: string,
  businessId: string
): Promise<DoctorIdentity | null> {
  const result = await pool.query<DoctorIdentity>(
    `SELECT id, full_name, professional_title, specialty
       FROM doctor WHERE id = $1 AND business_id = $2 LIMIT 1`,
    [doctorId, businessId]
  );
  return result.rows[0] ?? null;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requirePermission(request, DOCTOR_READERS);
    if (!auth.ok) return fail(auth.status, auth.message);
    if (!auth.user.business_id) return fail(400, "No business associated with this account.");
    const businessId: string = auth.user.business_id;

    const { id } = await context.params;
    const doctor: DoctorIdentity | null = await loadOwnedDoctor(id, businessId);
    if (!doctor) return fail(404, "Doctor not found.");
    const doctorId: string = doctor.id;

    const result = await pool.query<ProfileRow>(
      `SELECT doctor_id, photo_url, full_name, professional_title, specialty, experience,
              qualifications, additional_qualifications, short_bio, full_bio,
              professional_interests, areas_of_expertise, phone, email, languages, updated_at
         FROM doctor_profiles
        WHERE doctor_id = $1
        LIMIT 1`,
      [doctorId]
    );

    // Merge: the profile row owns every detailed field; identity fields
    // (full name / title / specialty) fall back to the doctor row so values
    // entered on the Doctor form always appear. The profile page maps this
    // response straight into the form, so NEVER return bare null — a null
    // would blank every field even when the database holds saved data.
    const profile = result.rows[0] ?? null;
    const data = {
      doctor_id: doctorId,
      photo_url: profile?.photo_url ?? null,
      full_name: profile?.full_name ?? doctor.full_name,
      professional_title: profile?.professional_title ?? doctor.professional_title,
      specialty: profile?.specialty ?? doctor.specialty,
      experience: profile?.experience ?? null,
      qualifications: profile?.qualifications ?? null,
      additional_qualifications: profile?.additional_qualifications ?? null,
      short_bio: profile?.short_bio ?? null,
      full_bio: profile?.full_bio ?? null,
      professional_interests: profile?.professional_interests ?? null,
      areas_of_expertise: profile?.areas_of_expertise ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      languages: profile?.languages ?? null,
      updated_at: profile?.updated_at ?? null,
    };

    return ok(data, profile ? "Doctor profile loaded." : "No profile yet.");
  } catch (error) {
    console.error("GET /api/doctors/[id]/profile failed:", error);
    return fail(500, "Unable to load the doctor profile. Please try again.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "doctor_profile");
  if (!auth.ok) return fail(auth.status, auth.message);
  if (!auth.user.business_id) return fail(400, "No business associated with this account.");
  const businessId: string = auth.user.business_id;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid request body.");
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  if (typeof raw.photoUrl === "string" && raw.photoUrl.length > MAX_PHOTO_DATA_URL_LENGTH * 1.5) {
    return fail(413, "Photo is too large. Please choose a smaller image.");
  }

  const result = validateDoctorProfile(raw as DoctorProfileInput);
  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        data: { errors: result.errors },
        error: "Please fix the highlighted fields.",
        message: "Please fix the highlighted fields.",
      },
      { status: 400 }
    );
  }

  const d = result.data;

  try {
    const doctor: { id: string } | null = await loadOwnedDoctor(id, businessId);
    if (!doctor) return fail(404, "Doctor not found.");
    const doctorId: string = doctor.id;

    const inserted = await pool.query<ProfileRow>(
      `INSERT INTO doctor_profiles (
         business_id, doctor_id, photo_url, full_name, professional_title, specialty,
         experience, qualifications, additional_qualifications, short_bio, full_bio,
         professional_interests, areas_of_expertise, phone, email, languages
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16
       )
       ON CONFLICT (doctor_id) WHERE doctor_id IS NOT NULL DO UPDATE SET
         business_id = EXCLUDED.business_id,
         photo_url = EXCLUDED.photo_url,
         full_name = EXCLUDED.full_name,
         professional_title = EXCLUDED.professional_title,
         specialty = EXCLUDED.specialty,
         experience = EXCLUDED.experience,
         qualifications = EXCLUDED.qualifications,
         additional_qualifications = EXCLUDED.additional_qualifications,
         short_bio = EXCLUDED.short_bio,
         full_bio = EXCLUDED.full_bio,
         professional_interests = EXCLUDED.professional_interests,
         areas_of_expertise = EXCLUDED.areas_of_expertise,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         languages = EXCLUDED.languages,
         updated_at = NOW()
       WHERE doctor_profiles.doctor_id = EXCLUDED.doctor_id
       RETURNING doctor_id, photo_url, full_name, professional_title, specialty, experience,
                 qualifications, additional_qualifications, short_bio, full_bio,
                 professional_interests, areas_of_expertise, phone, email, languages, updated_at`,
      [
        businessId,
        doctorId,
        d.photoUrl,
        d.fullName,
        d.professionalTitle,
        d.specialty,
        d.experience,
        d.qualifications,
        d.additionalQualifications,
        d.shortBio,
        d.fullBio,
        d.professionalInterests,
        d.areasOfExpertise,
        d.phone,
        d.email,
        d.languages,
      ]
    );

    return ok(inserted.rows[0], "Doctor profile saved successfully.");
  } catch (error) {
    console.error("PUT /api/doctors/[id]/profile failed:", error);
    return fail(500, "Unable to save the doctor profile. Please try again.");
  }
}
