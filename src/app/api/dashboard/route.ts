import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import {
  SELECT_WITH_JOINS,
  mapAppointment,
  type AppointmentRow,
} from "@/lib/appointmentsShared";
import type {
  DashboardAppointment,
  DashboardData,
  DashboardDoctor,
  DashboardPatient,
} from "@/lib/dashboardTypes";

export const dynamic = "force-dynamic";

/**
 * ONE dashboard data endpoint. All queries:
 *   - use the EXISTING tables (patient, doctor, appointment, clinic) via the
 *     shared pool in src/lib/db.ts — no new tables, no ORM, no mock data;
 *   - are parameterized and restricted to business_id taken from the JWT
 *     (never from the request), so businesses stay fully isolated;
 *   - only fetch what the dashboard shows (COUNT(*) for the stat cards,
 *     LIMIT 5 for recent patients, LIMIT 6 for doctors, date-ranged
 *     appointments) — no full-table scans.
 *
 * Pending Reports: the Reports module has no table/feature yet (it is still
 * a placeholder), so it intentionally returns the safe empty value 0 instead
 * of inventing fake records.
 */

const RECENT_PATIENTS_LIMIT = 5;
const DOCTORS_LIMIT = 6;
const TODAY_APPOINTMENTS_LIMIT = 10;
const UPCOMING_APPOINTMENTS_LIMIT = 12;

/** Server-local today as "YYYY-MM-DD" (browser clock is never trusted). */
function todayISO(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function envelope(data: unknown, message: string, success = true, status = 200) {
  return NextResponse.json(
    { data, error: success ? null : message, success, message },
    { status }
  );
}

function toDashboardAppointment(row: AppointmentRow): DashboardAppointment {
  const a = mapAppointment(row);
  return {
    id: a.id,
    appointmentId: a.appointmentId ?? null,
    patientName: a.patient.fullName ?? null,
    doctorName: a.doctor.fullName ?? null,
    clinicName: a.clinic.clinicName ?? null,
    appointmentDate: a.appointmentDate ?? null,
    appointmentTime: a.appointmentTime ?? null,
    status: a.status ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "overview");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(
        null,
        "No business associated with this account",
        false,
        400
      );
    }
    const businessId = auth.user.business_id;
    const today = todayISO();

    // All dashboard reads run in parallel on the existing pool.
    const [counts, recentPatients, doctors, todayAppts, upcomingAppts] =
      await Promise.all([
        // Stat cards: efficient COUNT(*) with the existing business indexes.
        pool.query<{
          total_patients: string;
          total_doctors: string;
          total_appointments: string;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM patient     WHERE business_id = $1) AS total_patients,
             (SELECT COUNT(*) FROM doctor      WHERE business_id = $1) AS total_doctors,
             (SELECT COUNT(*) FROM appointment WHERE business_id = $1) AS total_appointments`,
          [businessId]
        ),

        // Recent Patients: newest first, limited to keep the card clean.
        pool.query(
          `SELECT id, patient_id, full_name, created_at
             FROM patient
            WHERE business_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [businessId, RECENT_PATIENTS_LIMIT]
        ),

        // Doctors Overview: the same `doctor` rows the Doctors page lists.
        pool.query(
          `SELECT id, full_name, professional_title, specialty
             FROM doctor
            WHERE business_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [businessId, DOCTORS_LIMIT]
        ),

        // Today's appointments — "today" comes from the server date.
        pool.query<AppointmentRow>(
          `${SELECT_WITH_JOINS}
           WHERE a.business_id = $1 AND a.appointment_date = $2::date
           ORDER BY a.appointment_time ASC
           LIMIT ${TODAY_APPOINTMENTS_LIMIT}`,
          [businessId, today]
        ),

        // Upcoming: strictly after today (past appointments never appear),
        // sorted by date then time and grouped by date on the client.
        pool.query<AppointmentRow>(
          `${SELECT_WITH_JOINS}
           WHERE a.business_id = $1 AND a.appointment_date > $2::date
           ORDER BY a.appointment_date ASC, a.appointment_time ASC
           LIMIT ${UPCOMING_APPOINTMENTS_LIMIT}`,
          [businessId, today]
        ),
      ]);

    const totals = counts.rows[0];
    const asCount = (value: string | undefined | null): number => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    const data: DashboardData = {
      today,
      totalPatients: asCount(totals?.total_patients),
      totalDoctors: asCount(totals?.total_doctors),
      totalAppointments: asCount(totals?.total_appointments),
      pendingReports: 0, // reports feature not implemented yet — safe empty state
      recentPatients: recentPatients.rows.map((row) => {
        const r = row as {
          id: string;
          patient_id: string;
          full_name: string;
          created_at: string | Date;
        };
        const patient: DashboardPatient = {
          id: r.id,
          patientId: r.patient_id,
          fullName: r.full_name,
          createdAt:
            r.created_at instanceof Date
              ? r.created_at.toISOString()
              : String(r.created_at ?? ""),
        };
        return patient;
      }),
      doctors: doctors.rows.map((row) => {
        const r = row as {
          id: string;
          full_name: string;
          professional_title: string | null;
          specialty: string | null;
        };
        const doctor: DashboardDoctor = {
          id: r.id,
          fullName: r.full_name,
          professionalTitle: r.professional_title ?? null,
          specialty: r.specialty ?? null,
        };
        return doctor;
      }),
      todayAppointments: todayAppts.rows.map(toDashboardAppointment),
      upcomingAppointments: upcomingAppts.rows.map(toDashboardAppointment),
    };

    return envelope(data, "Dashboard loaded");
  } catch (err) {
    console.error("GET /api/dashboard failed:", err);
    return envelope(null, "Unable to load dashboard data", false, 500);
  }
}
