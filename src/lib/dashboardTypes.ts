/**
 * Shared (client + server) shapes for the dashboard payload returned by
 * GET /api/dashboard. Everything is scoped to the authenticated business.
 */

export type DashboardPatient = {
  id: string;
  /** Human-readable code, e.g. PT-20260923-0001. */
  patientId: string;
  fullName: string;
  createdAt: string;
};

export type DashboardDoctor = {
  id: string;
  fullName: string;
  professionalTitle: string | null;
  specialty: string | null;
};

export type DashboardAppointment = {
  id: string;
  /** Human-readable code, e.g. APT-20260923-5001. */
  appointmentId: string | null;
  patientName: string | null;
  doctorName: string | null;
  clinicName: string | null;
  /** "YYYY-MM-DD" as stored in PostgreSQL. */
  appointmentDate: string | null;
  /** "HH:MM" as stored in PostgreSQL. */
  appointmentTime: string | null;
  status: string | null;
};

export type DashboardData = {
  /** Server-local today ("YYYY-MM-DD") — the browser date is never used. */
  today: string;
  totalPatients: number;
  totalDoctors: number;
  totalAppointments: number;
  /**
   * No reports table/feature exists yet (the Reports module is still a
   * placeholder), so this stays at the safe empty value until it is connected.
   */
  pendingReports: number;
  /** Latest 5 patients, created_at DESC. */
  recentPatients: DashboardPatient[];
  /** Latest doctors for the overview card, created_at DESC. */
  doctors: DashboardDoctor[];
  /** Appointments scheduled for `today`, time ASC. */
  todayAppointments: DashboardAppointment[];
  /** Appointments after `today`, date ASC then time ASC (never past dates). */
  upcomingAppointments: DashboardAppointment[];
};
