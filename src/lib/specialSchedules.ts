/**
 * Shared Special Schedules definitions used by BOTH the API routes (server)
 * and the Special Schedules page (client). No server-only imports so the
 * client bundle can reuse the same helpers — one source of truth.
 *
 * A special schedule is the one-off OVERRIDE counterpart of the Weekly
 * Schedule: on a single specific date the clinic opens with DIFFERENT hours
 * than its recurring weekly pattern. It is always linked to the existing
 * `clinic` table through `clinic_id` (never identified by name or city).
 *
 * A fully closed date is an OFF-DAY (see lib/offDays.ts) — a date can never
 * be both an off-day and a special schedule for the same clinic.
 */

import { isValidDateString } from "@/lib/offDays";

export type ClinicSpecialSchedule = {
  id: string;
  clinic_id: string;
  special_date: string; // "YYYY-MM-DD"
  opening_time: string; // "HH:MM" (24h)
  closing_time: string; // "HH:MM" (24h)
  reason: string | null;
};

/** One item of GET /api/special-schedules: a clinic + its overrides. */
export type ClinicSpecialsItem = {
  clinic: {
    id: string;
    clinic_name: string;
    city: string;
    status: string;
  };
  specials: ClinicSpecialSchedule[];
};

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the form reuses
// the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export type SpecialFieldErrors = Partial<
  Record<"clinicId" | "specialDate" | "openingTime" | "closingTime" | "reason", string>
>;

export type SpecialInput = {
  clinicId?: unknown;
  specialDate?: unknown;
  openingTime?: unknown;
  closingTime?: unknown;
  reason?: unknown;
};

export type SpecialValidated = {
  clinicId: string;
  specialDate: string;
  openingTime: string;
  closingTime: string;
  reason: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function validateSpecialSchedule(
  raw: SpecialInput
): { ok: true; data: SpecialValidated } | { ok: false; errors: SpecialFieldErrors } {
  const errors: SpecialFieldErrors = {};

  // ---- clinicId (required UUID) ----
  let clinicId = "";
  if (typeof raw.clinicId !== "string" || !UUID_RE.test(raw.clinicId)) {
    errors.clinicId = "Please select a clinic.";
  } else {
    clinicId = raw.clinicId;
  }

  // ---- specialDate (required, real single calendar date) ----
  let specialDate = "";
  if (typeof raw.specialDate !== "string" || raw.specialDate.trim() === "") {
    errors.specialDate = "Please choose a date.";
  } else if (!isValidDateString(raw.specialDate.trim())) {
    errors.specialDate = "Please choose a valid date.";
  } else {
    specialDate = raw.specialDate.trim();
  }

  // ---- openingTime / closingTime (required, closing after opening) ----
  let openingTime = "";
  if (typeof raw.openingTime !== "string" || !TIME_RE.test(raw.openingTime.trim())) {
    errors.openingTime = "Opening time is required (HH:MM).";
  } else {
    openingTime = raw.openingTime.trim();
  }
  let closingTime = "";
  if (typeof raw.closingTime !== "string" || !TIME_RE.test(raw.closingTime.trim())) {
    errors.closingTime = "Closing time is required (HH:MM).";
  } else {
    closingTime = raw.closingTime.trim();
  }
  if (openingTime && closingTime && closingTime <= openingTime) {
    errors.closingTime = "Closing time must be after opening time.";
  }

  // ---- reason (optional label, <=255 chars) ----
  let reason: string | null = null;
  const reasonRaw = typeof raw.reason === "string" ? raw.reason.trim() : "";
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
  return { ok: true, data: { clinicId, specialDate, openingTime, closingTime, reason } };
}
