/**
 * Shared Staff Inbox definitions used by BOTH the API routes (server) and,
 * in a later step, the Staff Inbox page (client). No server-only imports so
 * the client bundle can reuse the same constants, types and helpers.
 *
 * One message = one row of `staff_messages` (sender + content), plus one
 * row per recipient in `staff_message_recipients` carrying that recipient's
 * read / star / archive state. Everything is scoped to the authenticated
 * business through `business_id` — resolved server-side from the JWT, never
 * from the request.
 *
 * NOTE: star/read/archive state exists ONLY on recipient rows (Step 2
 * schema), so those toggles are recipient-only actions; a sender cannot
 * star their own sent message. This is documented in the API report.
 */

// ---------------------------------------------------------------------------
// Enums (mirror the CHECK constraints of staff_messages)
// ---------------------------------------------------------------------------

export const SM_CATEGORIES = ["general", "announcement", "appointment", "urgent"] as const;
export type SmCategory = (typeof SM_CATEGORIES)[number];

export const SM_CATEGORY_LABELS: Record<SmCategory, string> = {
  general: "General",
  announcement: "Announcement",
  appointment: "Appointment",
  urgent: "Urgent",
};

export const SM_PRIORITIES = ["normal", "important", "urgent"] as const;
export type SmPriority = (typeof SM_PRIORITIES)[number];

export const SM_PRIORITY_LABELS: Record<SmPriority, string> = {
  normal: "Normal",
  important: "Important",
  urgent: "Urgent",
};

/** List filters understood by GET /api/staff-messages?filter=... */
export const SM_LIST_FILTERS = ["all", "inbox", "sent", "unread", "important", "archived"] as const;
export type SmListFilter = (typeof SM_LIST_FILTERS)[number];

// ---------------------------------------------------------------------------
// Types + mapping
// ---------------------------------------------------------------------------

/** Raw row shape as read from the canonical staff-message SELECT (JOINed). */
export type StaffMessageRow = {
  id: string;
  business_id: string;
  sender_id: number;
  subject: string;
  body: string;
  category: string;
  priority: string;
  created_at: string;
  updated_at: string;
  sender_name: string;
  /** My recipient row (NULL when I am only the sender / not a recipient). */
  recipient_row_id: string | null;
  is_read: boolean | null;
  read_at: string | Date | null;
  is_starred: boolean | null;
  is_archived: boolean | null;
  /** Total recipients of the message (pg COUNT arrives as a numeric string). */
  recipient_count: string | number;
};

/** API response shape (camelCase) for one message, from the viewer's perspective. */
export type StaffMessageItem = {
  id: string;
  subject: string;
  body: string;
  category: SmCategory;
  categoryLabel: string;
  priority: SmPriority;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  senderId: number;
  senderName: string;
  isSentByMe: boolean;
  /** NULL when the viewer has no recipient row (e.g. viewing their own sent message). */
  isRead: boolean | null;
  readAt: string | null;
  isStarred: boolean | null;
  isArchived: boolean | null;
  recipientCount: number;
};

export function asSmCategory(value: string): SmCategory {
  return (SM_CATEGORIES.find((c) => c === value) ?? "general") as SmCategory;
}

export function asSmPriority(value: string): SmPriority {
  return (SM_PRIORITIES.find((p) => p === value) ?? "normal") as SmPriority;
}

/** Normalize a timestamptz (Date from pg, or a string) into an ISO string. */
function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/** Map a raw DB row into the camelCase shape the frontend expects. */
export function mapStaffMessage(row: StaffMessageRow, viewerId: number): StaffMessageItem {
  const category = asSmCategory(row.category);
  const priority = asSmPriority(row.priority);
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    category,
    categoryLabel: SM_CATEGORY_LABELS[category],
    priority,
    priorityLabel: SM_PRIORITY_LABELS[priority],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    senderId: row.sender_id,
    senderName: row.sender_name,
    isSentByMe: row.sender_id === viewerId,
    isRead: row.is_read,
    readAt: toIso(row.read_at),
    isStarred: row.is_starred,
    isArchived: row.is_archived,
    recipientCount: Number(row.recipient_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the compose form
// will reuse the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export const MAX_SM_SUBJECT_LENGTH = 255;
export const MAX_SM_BODY_LENGTH = 20_000;
export const MAX_SM_RECIPIENTS = 50;

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export type SendInput = {
  subject?: unknown;
  body?: unknown;
  category?: unknown;
  priority?: unknown;
  recipientIds?: unknown;
};

export type SendFieldErrors = Partial<
  Record<"subject" | "body" | "category" | "priority" | "recipientIds", string>
>;

export type SendValidated = {
  subject: string;
  body: string;
  category: SmCategory;
  priority: SmPriority;
  recipientIds: number[];
};

/**
 * Validates the send payload. Recipient ids are users.id values (INTEGER
 * serial) — numbers or numeric strings are both accepted, duplicates are
 * removed, and existence + same-business ownership are verified separately
 * in the API against the authenticated business.
 */
export function validateSend(
  raw: SendInput
): { ok: true; data: SendValidated } | { ok: false; errors: SendFieldErrors } {
  const errors: SendFieldErrors = {};

  // ---- subject (required, 1–255 chars) ----
  const subject = asString(raw.subject);
  if (subject === "") {
    errors.subject = "Subject is required.";
  } else if (subject.length > MAX_SM_SUBJECT_LENGTH) {
    errors.subject = `Subject must be ${MAX_SM_SUBJECT_LENGTH} characters or fewer.`;
  }

  // ---- body (required, non-empty, capped) ----
  const body = asString(raw.body);
  if (body === "") {
    errors.body = "Message is required.";
  } else if (body.length > MAX_SM_BODY_LENGTH) {
    errors.body = `Message must be ${MAX_SM_BODY_LENGTH} characters or fewer.`;
  }

  // ---- category / priority (optional enums with defaults) ----
  let category: SmCategory = "general";
  const categoryRaw = asString(raw.category).toLowerCase();
  if (categoryRaw !== "") {
    const match = SM_CATEGORIES.find((c) => c === categoryRaw);
    if (!match) {
      errors.category = "Category must be general, announcement, appointment or urgent.";
    } else {
      category = match;
    }
  }

  let priority: SmPriority = "normal";
  const priorityRaw = asString(raw.priority).toLowerCase();
  if (priorityRaw !== "") {
    const match = SM_PRIORITIES.find((p) => p === priorityRaw);
    if (!match) {
      errors.priority = "Priority must be normal, important or urgent.";
    } else {
      priority = match;
    }
  }

  // ---- recipientIds (required non-empty array of integer user ids) ----
  const recipientIds: number[] = [];
  const rawIds = raw.recipientIds;
  if (!Array.isArray(rawIds)) {
    errors.recipientIds = "Recipients must be a list of staff accounts.";
  } else if (rawIds.length === 0) {
    errors.recipientIds = "Please choose at least one recipient.";
  } else if (rawIds.length > MAX_SM_RECIPIENTS) {
    errors.recipientIds = `A message can have at most ${MAX_SM_RECIPIENTS} recipients.`;
  } else {
    for (const entry of rawIds) {
      const n = typeof entry === "number" ? entry : Number(asString(entry));
      if (!Number.isInteger(n) || n <= 0) {
        errors.recipientIds = "Recipients must be valid staff accounts.";
        break;
      }
      if (!recipientIds.includes(n)) recipientIds.push(n); // dedupe
    }
    if (!errors.recipientIds && recipientIds.length === 0) {
      errors.recipientIds = "Please choose at least one recipient.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data: { subject, body, category, priority, recipientIds } };
}

export type StatusPatchInput = {
  isRead?: unknown;
  isStarred?: unknown;
  isArchived?: unknown;
};

export type StatusFieldErrors = Partial<
  Record<"isRead" | "isStarred" | "isArchived" | "form", string>
>;

export type StatusPatchValidated = {
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
};

/**
 * Validates a recipient-status PATCH. Only the keys present in the payload
 * are applied (partial update); every provided value must be a real boolean,
 * and at least one known field is required.
 */
export function validateStatusPatch(
  raw: StatusPatchInput
): { ok: true; data: StatusPatchValidated } | { ok: false; errors: StatusFieldErrors } {
  const errors: StatusFieldErrors = {};
  const data: StatusPatchValidated = {};

  const take = (key: "isRead" | "isStarred" | "isArchived", source: StatusPatchInput) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const value = source[key];
    if (typeof value !== "boolean") {
      errors[key] = `${key} must be true or false.`;
      return;
    }
    data[key] = value;
  };

  take("isRead", raw);
  take("isStarred", raw);
  take("isArchived", raw);

  if (Object.keys(errors).length === 0 && Object.keys(data).length === 0) {
    errors.form = "Provide at least one of isRead, isStarred or isArchived.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data };
}
