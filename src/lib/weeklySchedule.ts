/**
 * Shared Weekly Schedule definitions used by BOTH the API routes (server)
 * and the Weekly Schedule page (client).
 *
 * Deliberately free of server-only imports (no db pool) so the client bundle
 * can reuse the same constants, types and helpers — one source of truth.
 *
 * Schedule rows live in `clinic_weekly_schedule`, always linked to the
 * existing `clinic` table through `clinic_id` (never by name or city).
 */

export const WEEKLY_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WeeklyDay = (typeof WEEKLY_DAYS)[number];

/** One day of a clinic's weekly schedule (maps to clinic_weekly_schedule). */
export type WeeklyScheduleDay = {
  day: WeeklyDay;
  is_open: boolean;
  opening_time: string | null; // "HH:MM" (24h)
  closing_time: string | null; // "HH:MM" (24h)
};

/** Raw row shape as read from clinic_weekly_schedule. */
export type WeeklyScheduleRow = {
  day_of_week: string;
  is_open: boolean;
  opening_time: string | null;
  closing_time: string | null;
};

/** One item of GET /api/weekly-schedule: clinic info + its 7-day schedule. */
export type WeeklyClinicSchedule = {
  clinic: {
    id: string;
    clinic_name: string;
    city: string;
    status: string;
  };
  schedule: WeeklyScheduleDay[];
};

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isWeeklyDay(value: unknown): value is WeeklyDay {
  return (
    typeof value === "string" && (WEEKLY_DAYS as readonly string[]).includes(value)
  );
}

/**
 * Safe default for a brand-new clinic: every day Closed.
 * Working hours are NEVER invented — the admin configures them afterwards.
 */
export function defaultWeeklySchedule(): WeeklyScheduleDay[] {
  return WEEKLY_DAYS.map((day) => ({
    day,
    is_open: false,
    opening_time: null,
    closing_time: null,
  }));
}

/**
 * Builds the canonical Monday→Sunday schedule from DB rows, always in the
 * canonical order. Days without a stored row render as Closed, so missing
 * rows can never produce a fake opening time.
 */
export function buildWeeklySchedule(rows: WeeklyScheduleRow[]): WeeklyScheduleDay[] {
  const byDay = new Map<string, WeeklyScheduleRow>();
  for (const row of rows) {
    if (isWeeklyDay(row.day_of_week)) {
      byDay.set(row.day_of_week, row);
    }
  }

  return WEEKLY_DAYS.map((day) => {
    const row = byDay.get(day);
    if (!row) {
      return { day, is_open: false, opening_time: null, closing_time: null };
    }
    return {
      day,
      is_open: Boolean(row.is_open),
      opening_time: row.is_open ? (row.opening_time ?? null) : null,
      closing_time: row.is_open ? (row.closing_time ?? null) : null,
    };
  });
}

/** 24h "HH:MM" -> "4:00 PM"; "—" when no time is stored. */
export function formatScheduleTime(time: string | null): string {
  if (!time) return "—";
  const [hStr, m] = time.split(":");
  const h = Number(hStr);
  if (!Number.isFinite(h)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the edit form
// reuses the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export type ScheduleDayInput = {
  day?: unknown;
  isOpen?: unknown;
  openingTime?: unknown;
  closingTime?: unknown;
};

export type ValidatedScheduleDay = {
  day: WeeklyDay;
  isOpen: boolean;
  openingTime: string | null;
  closingTime: string | null;
};

export function validateWeeklySchedule(
  raw: unknown
): { ok: true; data: ValidatedScheduleDay[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Please provide at least one day." };
  }

  const seen = new Set<WeeklyDay>();
  const days: ValidatedScheduleDay[] = [];

  for (const entry of raw as ScheduleDayInput[]) {
    const day = entry?.day;
    if (!isWeeklyDay(day)) {
      return { ok: false, error: `Invalid day: ${String(day)}` };
    }
    if (seen.has(day)) {
      return { ok: false, error: `${day} is provided more than once.` };
    }
    seen.add(day);

    const isOpen = entry.isOpen;
    if (typeof isOpen !== "boolean") {
      return {
        ok: false,
        error: `${day}: active status must be true or false.`,
      };
    }

    if (!isOpen) {
      days.push({ day, isOpen: false, openingTime: null, closingTime: null });
      continue;
    }

    const openingTime =
      typeof entry.openingTime === "string" ? entry.openingTime.trim() : "";
    const closingTime =
      typeof entry.closingTime === "string" ? entry.closingTime.trim() : "";

    if (!TIME_RE.test(openingTime)) {
      return { ok: false, error: `${day}: please enter a valid opening time.` };
    }
    if (!TIME_RE.test(closingTime)) {
      return { ok: false, error: `${day}: please enter a valid closing time.` };
    }
    if (closingTime <= openingTime) {
      return {
        ok: false,
        error: `${day}: closing time must be after opening time.`,
      };
    }

    days.push({ day, isOpen: true, openingTime, closingTime });
  }

  return { ok: true, data: days };
}
