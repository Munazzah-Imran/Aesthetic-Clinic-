/**
 * Shared Off-Days definitions used by BOTH the API routes (server) and the
 * Off-Days page (client). No server-only imports so the client bundle can
 * reuse the same constants, types and helpers — one source of truth.
 *
 * One off-day = one single date on which ONE clinic is closed, stored in
 * `clinic_off_day` and always linked to the existing `clinic` table through
 * `clinic_id` (never identified by name or city). The same date may be an
 * off-day for several clinics.
 */

export type ClinicOffDay = {
  id: string;
  clinic_id: string;
  off_date: string; // "YYYY-MM-DD"
  reason: string | null;
};

/** One item of GET /api/off-days: a clinic + its off-days (may be empty). */
export type ClinicOffDaysItem = {
  clinic: {
    id: string;
    clinic_name: string;
    city: string;
    status: string;
  };
  offDays: ClinicOffDay[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  );
}

export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "YYYY-MM-DD" -> "Sun, 25 Dec 2026" (built from parts — no TZ shifts). */
export function formatOffDate(value: string): string {
  if (!isValidDateString(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_LABELS[date.getDay()]}, ${d} ${MONTH_LABELS[m - 1]} ${y}`;
}

/** True when the date is before today (shown dimmed in the list). */
export function isPastOffDate(value: string): boolean {
  return isValidDateString(value) && value < todayISO();
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the form reuses
// the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export type OffDayInput = {
  clinicId?: unknown;
  offDate?: unknown;
  reason?: unknown;
};

export type OffDayFieldErrors = Partial<Record<"clinicId" | "offDate" | "reason", string>>;

export type OffDayValidated = {
  clinicId: string;
  offDate: string;
  reason: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateOffDay(
  raw: OffDayInput
): { ok: true; data: OffDayValidated } | { ok: false; errors: OffDayFieldErrors } {
  const errors: OffDayFieldErrors = {};

  // ---- clinicId (required UUID) ----
  let clinicId = "";
  if (typeof raw.clinicId !== "string" || !UUID_RE.test(raw.clinicId)) {
    errors.clinicId = "Please select a clinic.";
  } else {
    clinicId = raw.clinicId;
  }

  // ---- offDate (required, real single calendar date) ----
  let offDate = "";
  if (typeof raw.offDate !== "string" || raw.offDate.trim() === "") {
    errors.offDate = "Please choose a date.";
  } else if (!isValidDateString(raw.offDate.trim())) {
    errors.offDate = "Please choose a valid date.";
  } else {
    offDate = raw.offDate.trim();
  }

  // ---- reason (optional label, <=255 chars) ----
  let reason: string | null = null;
  const reasonRaw =
    typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reasonRaw !== "") {
    if (reasonRaw.length > 255) {
      errors.reason = "Reason must be 255 characters or fewer.";
    } else {
      reason = reasonRaw;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data: { clinicId, offDate, reason } };
}
