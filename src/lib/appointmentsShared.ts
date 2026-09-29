import pool from "@/lib/db";

/**
 * Shared appointment SQL/helpers (server-only).
 *
 * The appointment module reuses the existing patient, doctor_profiles and
 * clinic tables — names come from JOINs, never duplicated on the appointment
 * row. Business isolation is enforced in every query.
 */

export type AppointmentRow = {
  id: string;
  business_id: string;
  appointment_id: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string;
  appointment_date: string;
  appointment_time: string;
  appointment_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  patient_full_name: string | null;
  patient_code: string | null;
  patient_phone: string | null;
  doctor_full_name: string | null;
  doctor_title: string | null;
  doctor_specialty: string | null;
  clinic_name: string | null;
  clinic_city: string | null;
  clinic_address: string | null;
  clinic_contact: string | null;
};

/** Convert a DB row into the camelCase shape the frontend expects (includes JOIN data). */
export function mapAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    businessId: row.business_id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    clinicId: row.clinic_id,
    appointmentDate: typeof row.appointment_date === "string" ? row.appointment_date.slice(0, 10) : row.appointment_date,
    appointmentTime: typeof row.appointment_time === "string" ? row.appointment_time.slice(0, 5) : row.appointment_time,
    appointmentType: row.appointment_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    patient: {
      fullName: row.patient_full_name,
      patientId: row.patient_code,
      phone: row.patient_phone,
    },
    doctor: {
      fullName: row.doctor_full_name,
      professionalTitle: row.doctor_title,
      specialty: row.doctor_specialty,
    },
    clinic: {
      clinicName: row.clinic_name,
      city: row.clinic_city,
      fullClinicAddress: row.clinic_address,
      contactNumber: row.clinic_contact,
    },
  };
}

/** JOIN with the existing patient, doctor_profiles and clinic tables for display data. */
export const SELECT_WITH_JOINS = `
  SELECT a.id,
         a.business_id,
         a.appointment_id,
         a.patient_id,
         a.doctor_id,
         a.clinic_id,
         a.appointment_date::text AS appointment_date,
         a.appointment_time::text AS appointment_time,
         a.appointment_type,
         a.status,
         a.created_at,
         a.updated_at,
         p.full_name  AS patient_full_name,
         p.patient_id AS patient_code,
         p.phone      AS patient_phone,
         d.full_name AS doctor_full_name,
         d.professional_title AS doctor_title,
         d.specialty AS doctor_specialty,
         c.clinic_name AS clinic_name,
         c.city        AS clinic_city,
         c.full_clinic_address AS clinic_address,
         c.contact_number      AS clinic_contact
  FROM appointment a
  LEFT JOIN patient p ON p.id = a.patient_id
  LEFT JOIN doctor d ON d.id = a.doctor_id
  LEFT JOIN clinic c ON c.id = a.clinic_id`;

/**
 * Verify that the referenced patient, doctor and clinic all belong to the
 * authenticated business. IDs arriving from the frontend are never trusted.
 */
export async function verifyOwnership(
  businessId: string,
  patientId: string,
  doctorId: string,
  clinicId: string
): Promise<{ ok: true } | { ok: false; field: string; message: string }> {
  const patient = await pool.query(
    "SELECT 1 FROM patient WHERE id = $1 AND business_id = $2 LIMIT 1",
    [patientId, businessId]
  );
  if (patient.rows.length === 0) {
    return { ok: false, field: "patientId", message: "Selected patient does not belong to your business." };
  }
  const doctor = await pool.query(
    "SELECT 1 FROM doctor WHERE id = $1 AND business_id = $2 LIMIT 1",
    [doctorId, businessId]
  );
  if (doctor.rows.length === 0) {
    return { ok: false, field: "doctorId", message: "Selected doctor does not belong to your business." };
  }
  const clinic = await pool.query(
    "SELECT 1 FROM clinic WHERE id = $1 AND business_id = $2 LIMIT 1",
    [clinicId, businessId]
  );
  if (clinic.rows.length === 0) {
    return { ok: false, field: "clinicId", message: "Selected clinic does not belong to your business." };
  }
  return { ok: true };
}

/**
 * Duplicate slot protection: same doctor + clinic + date + time already
 * booked within the business. Cancelled and no-show slots free the time.
 */
export async function slotConflict(
  businessId: string,
  doctorId: string,
  clinicId: string,
  date: string,
  time: string,
  excludeId?: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM appointment
      WHERE business_id = $1
        AND doctor_id = $2
        AND clinic_id = $3
        AND appointment_date = $4::date
        AND appointment_time = $5::time
        AND status NOT IN ('cancelled', 'no_show')
        AND ($6::uuid IS NULL OR id != $6::uuid)
      LIMIT 1`,
    [businessId, doctorId, clinicId, date, time, excludeId ?? null]
  );
  return result.rows.length > 0;
}
