/**
 * Shared Blocked Slots definitions used by BOTH the API routes (server) and
 * the Blocked Slots page (client). No server-only imports so the client
 * bundle can reuse the same constants, types and helpers — one source of
 * truth.
 *
 * One blocked slot = one time range on ONE date for ONE clinic, stored in
 * `clinic_blocked_slot` and always linked to the existing `clinic` table
 * through `clinic_id` (never identified by name or city). Any appointment
 * whose start time falls inside the range [start_time, end_time) on that
 * date is rejected by the Appointments API.
 */

import { isValidDateString } from "@/lib/offDays";

export type ClinicBlockedSlot = {
  id: string;
  clinic_id: string;
  block_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM" (24h)
  end_time: string; // "HH:MM" (24h)
  reason: string | null;
};

/** One item of GET /api/blocked-slots: a clinic + its blocked slots. */
export type ClinicBlockedSlotsItem = {
  clinic: {
    id: string;
    clinic_name: string;
    city: string;
    status: string;
  };
  slots: ClinicBlockedSlot[];
};

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** True when the time (HH:MM) is inside [start, end) — the blocking rule. */
export function isTimeWithinSlot(
  time: string,
  start: string,
  end: string
): boolean {
  const t = time.slice(0, 5);
  return t >= start && t < end;
}

/** True when ANY blocked slot for the date covers the given time. */
export function slotCoversTime(
  slots: ClinicBlockedSlot[],
  date: string,
  time: string
): boolean {
  return slots.some(
    (slot) =>
      slot.block_date === date && isTimeWithinSlot(time, slot.start_time, slot.end_time)
  );
}

/** True when the two ranges overlap on the same date (half-open intervals). */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the form reuses
// the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export type BlockedSlotInput = {
  clinicId?: unknown;
  blockDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  reason?: unknown;
};

export type BlockedSlotFieldErrors = Partial<
  Record<"clinicId" | "blockDate" | "startTime" | "endTime" | "reason", string>
>;

export type BlockedSlotValidated = {
  clinicId: string;
  blockDate: string;
  startTime: string;
  endTime: string;
  reason: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBlockedSlot(
  raw: BlockedSlotInput
): { ok: true; data: BlockedSlotValidated } | { ok: false; errors: BlockedSlotFieldErrors } {
  const errors: BlockedSlotFieldErrors = {};

  // ---- clinicId (required UUID) ----
  let clinicId = "";
  if (typeof raw.clinicId !== "string" || !UUID_RE.test(raw.clinicId)) {
    errors.clinicId = "Please select a clinic.";
  } else {
    clinicId = raw.clinicId;
  }

  // ---- blockDate (required, real single calendar date) ----
  let blockDate = "";
  if (typeof raw.blockDate !== "string" || raw.blockDate.trim() === "") {
    errors.blockDate = "Please choose a date.";
  } else if (!isValidDateString(raw.blockDate.trim())) {
    errors.blockDate = "Please choose a valid date.";
  } else {
    blockDate = raw.blockDate.trim();
  }

  // ---- startTime / endTime (required 24h times, end after start) ----
  let startTime = "";
  if (typeof raw.startTime !== "string" || !TIME_RE.test(raw.startTime.trim())) {
    errors.startTime = "Please choose a start time.";
  } else {
    startTime = raw.startTime.trim();
  }

  let endTime = "";
  if (typeof raw.endTime !== "string" || !TIME_RE.test(raw.endTime.trim())) {
    errors.endTime = "Please choose an end time.";
  } else {
    endTime = raw.endTime.trim();
  }

  if (!errors.startTime && !errors.endTime && endTime <= startTime) {
    errors.endTime = "End time must be after the start time.";
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
  return { ok: true, data: { clinicId, blockDate, startTime, endTime, reason } };
}
