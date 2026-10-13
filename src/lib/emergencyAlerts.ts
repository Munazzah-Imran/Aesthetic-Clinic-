/**
 * Shared Emergency Alerts definitions used by BOTH the API routes (server)
 * and the Emergency Alerts page (client). No server-only imports so the
 * client bundle can reuse the same constants, types and helpers — one
 * source of truth.
 *
 * One alert = one row of the `emergency_alert` table, always scoped to the
 * authenticated business through `business_id`. The patient, appointment
 * and clinic are OPTIONAL references to the EXISTING rows — patient name
 * and phone are read through a JOIN (never duplicated), and an alert
 * without a patient renders as "—" instead of invented data.
 */

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const ALERT_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];

export const ALERT_PRIORITY_LABELS: Record<AlertPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Compact badges that stay inside the EXISTING dashboard palette:
 * red = critical, amber = high, the dashboard's blue = medium,
 * the existing neutral gray = low. Critical and High are clearly
 * distinguishable without any new colors.
 */
export const ALERT_PRIORITY_STYLES: Record<AlertPriority, string> = {
  critical: "bg-red-500/15 text-red-700 border-red-500/30",
  high: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  medium: "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30",
  low: "bg-[#E2E8F0] text-[#5B6B7C] border-[#E2E8F0]",
};

// ---------------------------------------------------------------------------
// Status workflow — ONLY states this backend can actually reach.
// ---------------------------------------------------------------------------

export const ALERT_STATUSES = [
  "new",
  "acknowledged",
  "in_progress",
  "resolved",
  "dismissed",
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** Badge classes matching the existing dashboard status chips. */
export const ALERT_STATUS_STYLES: Record<AlertStatus, string> = {
  new: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  acknowledged: "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30",
  in_progress: "bg-sky-500/15 text-sky-700 border-sky-600/30",
  resolved: "bg-sky-600/15 text-sky-700 border-sky-600/30",
  dismissed: "bg-[#E2E8F0] text-[#5B6B7C] border-[#E2E8F0]",
};

/**
 * Workflow: only these transitions are allowed (matches the actions the UI
 * offers per status — Resolved and Dismissed are terminal). Enforced on the
 * SERVER so the API cannot be bypassed from the browser.
 */
export const ALERT_ALLOWED_TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  new: ["acknowledged", "dismissed"],
  acknowledged: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: [],
  dismissed: [],
};

/** Is `next` a legal transition from `current`? */
export function isValidAlertTransition(current: string, next: string): boolean {
  const from = asAlertStatus(current);
  const to = asAlertStatus(next);
  return ALERT_ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Types + mapping
// ---------------------------------------------------------------------------

/** Raw row shape as read from `emergency_alert` (JOINed display data). */
export type EmergencyAlertRow = {
  id: string;
  business_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  clinic_id: string | null;
  alert_id: string;
  priority: string;
  alert_message: string;
  status: string;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | Date | null;
  patient_full_name: string | null;
  patient_code: string | null;
  patient_phone: string | null;
  appointment_code: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  clinic_name: string | null;
};

/** API response shape (camelCase) for one alert row. */
export type EmergencyAlertItem = {
  id: string;
  alertId: string;
  patientId: string | null;
  patientName: string | null;
  patientCode: string | null;
  phone: string | null;
  priority: AlertPriority;
  priorityLabel: string;
  message: string;
  status: AlertStatus;
  statusLabel: string;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  appointmentId: string | null;
  appointmentCode: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  clinicId: string | null;
  clinicName: string | null;
};

/** Coerce any string into a known priority (unknown values fall back to medium). */
export function asAlertPriority(value: string): AlertPriority {
  return (ALERT_PRIORITIES.find((p) => p === value) ?? "medium") as AlertPriority;
}

/** Coerce any string into a known status (unknown values fall back to new). */
export function asAlertStatus(value: string): AlertStatus {
  return (ALERT_STATUSES.find((s) => s === value) ?? "new") as AlertStatus;
}

/** Normalize a timestamptz (Date from pg, or a string) into an ISO string. */
function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/** Map a raw DB row into the camelCase shape the frontend expects. */
export function mapAlert(row: EmergencyAlertRow): EmergencyAlertItem {
  const priority = asAlertPriority(row.priority);
  const status = asAlertStatus(row.status);
  return {
    id: row.id,
    alertId: row.alert_id,
    patientId: row.patient_id,
    patientName: row.patient_full_name,
    patientCode: row.patient_code,
    phone: row.patient_phone,
    priority,
    priorityLabel: ALERT_PRIORITY_LABELS[priority],
    message: row.alert_message,
    status,
    statusLabel: ALERT_STATUS_LABELS[status],
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: toIso(row.resolved_at),
    appointmentId: row.appointment_id,
    appointmentCode: row.appointment_code,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
  };
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the forms reuse
// the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** Optional UUID field: empty -> null, otherwise must be a UUID. */
function optionalUuid(
  value: unknown,
  field: "patientId" | "appointmentId" | "clinicId",
  errors: AlertFieldErrors
): string | null {
  const raw = asString(value);
  if (raw === "") return null;
  if (!UUID_RE.test(raw)) {
    errors[field] = "Invalid selection.";
    return null;
  }
  return raw;
}

export type AlertInput = {
  patientId?: unknown;
  appointmentId?: unknown;
  clinicId?: unknown;
  priority?: unknown;
  message?: unknown;
};

export type AlertFieldErrors = Partial<
  Record<
    "patientId" | "appointmentId" | "clinicId" | "priority" | "message" | "status" | "resolutionNotes",
    string
  >
>;

export type AlertValidated = {
  patientId: string | null;
  appointmentId: string | null;
  clinicId: string | null;
  priority: AlertPriority;
  message: string;
};

/**
 * Validates the create payload. The patient is OPTIONAL (an alert does not
 * have to be patient-specific) but, when given, must reference an existing
 * patient — ownership is verified in the API against the authenticated
 * business, and the EXISTING patient row is always reused.
 */
export function validateAlert(
  raw: AlertInput
): { ok: true; data: AlertValidated } | { ok: false; errors: AlertFieldErrors } {
  const errors: AlertFieldErrors = {};

  const patientId = optionalUuid(raw.patientId, "patientId", errors);
  const appointmentId = optionalUuid(raw.appointmentId, "appointmentId", errors);
  const clinicId = optionalUuid(raw.clinicId, "clinicId", errors);

  // ---- priority (required enum) ----
  const priorityRaw = asString(raw.priority).toLowerCase();
  const priority = ALERT_PRIORITIES.find((p) => p === priorityRaw);
  if (!priority) {
    errors.priority = "Please choose a priority.";
  }

  // ---- message (required, 2–2000 chars) ----
  let message = "";
  const messageRaw = asString(raw.message);
  if (messageRaw === "") {
    errors.message = "Alert message is required.";
  } else if (messageRaw.length < 2) {
    errors.message = "Alert message must be at least 2 characters.";
  } else if (messageRaw.length > 2000) {
    errors.message = "Alert message must be 2000 characters or fewer.";
  } else {
    message = messageRaw;
  }

  if (Object.keys(errors).length > 0 || !priority) {
    return { ok: false, errors };
  }
  return { ok: true, data: { patientId, appointmentId, clinicId, priority, message } };
}

export type AlertPatchInput = {
  status?: unknown;
  resolutionNotes?: unknown;
};

export type AlertPatchValidated = {
  status: AlertStatus;
  /** undefined = leave the stored notes unchanged; string/null = replace. */
  resolutionNotes: string | null | undefined;
};

/**
 * Validates a status PATCH. `resolutionNotes` is optional — when the key is
 * absent the stored notes stay untouched; when present, empty normalizes to
 * null (never an empty string).
 */
export function validateAlertPatch(
  raw: AlertPatchInput
): { ok: true; data: AlertPatchValidated } | { ok: false; errors: AlertFieldErrors } {
  const errors: AlertFieldErrors = {};

  const statusRaw = asString(raw.status).toLowerCase();
  const status = ALERT_STATUSES.find((s) => s === statusRaw);
  if (!status) {
    errors.status =
      "Status must be New, Acknowledged, In Progress, Resolved or Dismissed.";
  }

  let resolutionNotes: string | null | undefined;
  if (Object.prototype.hasOwnProperty.call(raw, "resolutionNotes")) {
    const notesRaw = asString(raw.resolutionNotes);
    if (notesRaw !== "" && notesRaw.length > 2000) {
      errors.resolutionNotes = "Resolution notes must be 2000 characters or fewer.";
    } else {
      resolutionNotes = notesRaw === "" ? null : notesRaw;
    }
  }

  if (Object.keys(errors).length > 0 || !status) {
    return { ok: false, errors };
  }
  return { ok: true, data: { status, resolutionNotes } };
}
