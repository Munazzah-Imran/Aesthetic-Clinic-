/**
 * Shared appointment validation (server is the source of truth; the form
 * reuses the same rules so UI errors match the backend exactly).
 *
 * Field names map to the `appointment` table columns. patientId/doctorId/
 * clinicId arrive as UUID strings (from the searchable dropdowns) and are
 * verified against the authenticated business by the API before use.
 * Empty optional fields are normalized to `null` (never empty strings).
 */

export const APPOINTMENT_TYPES = [
  "consultation",
  "follow_up",
  "check_up",
  "procedure",
  "other",
] as const;

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type AppointmentInput = {
  patientId: unknown;
  doctorId: unknown;
  clinicId: unknown;
  appointmentDate: unknown;
  appointmentTime: unknown;
  appointmentType: unknown;
  status: unknown;
};

export type AppointmentValidated = {
  patientId: string;
  doctorId: string;
  clinicId: string;
  appointmentDate: string; // "YYYY-MM-DD"
  appointmentTime: string; // "HH:MM"
  appointmentType: AppointmentType;
  status: AppointmentStatus;
};

export type AppointmentFieldErrors = Partial<Record<keyof AppointmentInput, string>>;

/** User-friendly labels for enums. */
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  consultation: "Consultation",
  follow_up: "Follow-up",
  check_up: "Check-up",
  procedure: "Procedure",
  other: "Other",
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO date as produced by <input type="date">. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 24h time as produced by <input type="time"> ("HH:MM" or "HH:MM:SS"). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function asOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function requiredUuid(value: unknown, label: string): { error?: string; value: string } {
  const raw = asOptionalString(value);
  if (raw === "") return { error: `${label} is required.`, value: "" };
  if (!UUID_RE.test(raw)) return { error: `Invalid ${label.toLowerCase()}.`, value: "" };
  return { value: raw.toLowerCase() };
}

export function validateAppointment(
  raw: AppointmentInput,
  options: { allowPastDates?: boolean } = {}
): { ok: true; data: AppointmentValidated } | { ok: false; errors: AppointmentFieldErrors } {
  const errors: AppointmentFieldErrors = {};

  // ---- required relations ----
  const patientId = requiredUuid(raw.patientId, "Patient");
  if (patientId.error) errors.patientId = patientId.error;
  const doctorId = requiredUuid(raw.doctorId, "Doctor");
  if (doctorId.error) errors.doctorId = doctorId.error;
  const clinicId = requiredUuid(raw.clinicId, "Clinic");
  if (clinicId.error) errors.clinicId = clinicId.error;

  // ---- appointmentDate (required, valid calendar date, not before today) ----
  let appointmentDate = "";
  const dateRaw = asOptionalString(raw.appointmentDate);
  if (dateRaw === "") {
    errors.appointmentDate = "Appointment date is required.";
  } else if (!DATE_RE.test(dateRaw) || Number.isNaN(new Date(dateRaw + "T00:00:00").getTime())) {
    errors.appointmentDate = "Appointment date must be a valid date.";
  } else {
    const [y, m, d] = dateRaw.split("-").map(Number);
    const real =
      new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1 &&
      new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
    if (!real) {
      errors.appointmentDate = "Appointment date must be a valid date.";
    } else if (!options.allowPastDates) {
      const today = new Date();
      const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      if (Date.UTC(y, m - 1, d) < todayUtc) {
        errors.appointmentDate = "Appointment date cannot be in the past.";
      } else {
        appointmentDate = dateRaw;
      }
    } else {
      // Editing an existing record: past dates stay valid (e.g. changing the
      // status of an appointment that already happened).
      appointmentDate = dateRaw;
    }
  }

  // ---- appointmentTime (required, valid 24h time) ----
  let appointmentTime = "";
  const timeRaw = asOptionalString(raw.appointmentTime);
  if (timeRaw === "") {
    errors.appointmentTime = "Appointment time is required.";
  } else if (!TIME_RE.test(timeRaw)) {
    errors.appointmentTime = "Appointment time must be a valid time.";
  } else {
    appointmentTime = timeRaw.slice(0, 5); // normalize "HH:MM"
  }

  // ---- appointmentType (required enum) ----
  let appointmentType: AppointmentType | null = null;
  const typeRaw = asOptionalString(raw.appointmentType);
  if (typeRaw === "") {
    errors.appointmentType = "Appointment type is required.";
  } else {
    const match = APPOINTMENT_TYPES.find((t) => t === typeRaw);
    if (!match) {
      errors.appointmentType = "Invalid appointment type.";
    } else {
      appointmentType = match;
    }
  }

  // ---- status (required enum, default scheduled) ----
  let status: AppointmentStatus = "scheduled";
  const statusRaw = asOptionalString(raw.status);
  if (statusRaw !== "") {
    const match = APPOINTMENT_STATUSES.find((s) => s === statusRaw);
    if (!match) {
      errors.status = "Invalid status.";
    } else {
      status = match;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      patientId: patientId.value,
      doctorId: doctorId.value,
      clinicId: clinicId.value,
      appointmentDate,
      appointmentTime,
      appointmentType: appointmentType as AppointmentType,
      status,
    },
  };
}
