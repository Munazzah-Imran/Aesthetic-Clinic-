/**
 * Display helpers for the dashboard cards. Pure formatting — values straight
 * from PostgreSQL are never mutated, only rendered for humans.
 * Every helper falls back to "—" so `undefined`/`null`/`NaN` never leak into UI.
 */

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Clean fallback for optional/missing values. */
export function display(value?: string | null): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" || v === "undefined" || v === "null" ? "—" : v;
}

/** "23 September 2026" from a "YYYY-MM-DD" date (no timezone shift). */
export function formatDateHeading(value?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? "").trim());
  if (!m) return "—";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "—";
  return `${day} ${MONTHS_FULL[month - 1]} ${year}`;
}

/** "23 Sep 2026" from a timestamp or "YYYY-MM-DD" value. */
export function formatShortDate(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "10:30 AM" from "HH:MM" (or "HH:MM:SS"). */
export function formatTime(value?: string | null): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec((value ?? "").trim());
  if (!m) return "—";
  const hour = Number(m[1]);
  const minute = m[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, "0")}:${minute} ${suffix}`;
}

/** Two-letter avatar initials from a full name. */
export function initialsOf(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

/** Human status label; unknown/missing -> "—" (never raw null/undefined). */
export function statusLabel(status?: string | null): string {
  const raw = (status ?? "").trim().toLowerCase();
  if (!raw) return "—";
  if (STATUS_LABELS[raw]) return STATUS_LABELS[raw];
  return raw.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Theme-consistent badge colors for appointment statuses. */
export function statusBadgeClass(status?: string | null): string {
  switch ((status ?? "").trim().toLowerCase()) {
    case "confirmed":
    case "completed":
      return "bg-sky-500/15 text-sky-400 border border-sky-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-400 border border-red-500/30";
    case "no_show":
      return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
    case "scheduled":
    default:
      return "bg-sky-500/15 text-sky-400 border border-sky-500/30";
  }
}
