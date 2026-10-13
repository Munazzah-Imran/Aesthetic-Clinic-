/**
 * Server-only read helpers for `staff_messages` / `staff_message_recipients`
 * (Staff Inbox). The tables are created by scripts/migrate-staff-inbox.mjs —
 * this module never creates or alters schema, it only reads.
 *
 * Every query is scoped to (a) the authenticated business through
 * `business_id` and (b) the authenticated user through the viewer id — both
 * always come from requireAuth(), never from the request.
 *
 * Security model: no RLS (matches the rest of this database); tenancy is
 * enforced here with parameterized WHERE clauses, exactly like appointments,
 * reports, consultations and alerts.
 */
import pool from "@/lib/db";
import {
  SM_LIST_FILTERS,
  type SmListFilter,
  type StaffMessageRow,
} from "@/lib/staffMessages";

/**
 * Canonical SELECT for ONE message with its display data:
 *  - sender name from the EXISTING users row (id + name ONLY — the password
 *    column is never selected, so it can never leak into a response);
 *  - the VIEWER's recipient row (NULL when the viewer is only the sender);
 *  - the total recipient count (useful for sent messages).
 * The LEFT JOIN is parameterized on the viewer id, so the same statement
 * serves list, detail and post-insert read-back.
 */
/**
 * Builds the canonical SELECT with the viewer parameter at the caller's
 * chosen position (e.g. "$3"). The position is interpolated, never the
 * value — all values still travel as bound parameters. This keeps EVERY
 * supplied parameter referenced by the SQL text (PostgreSQL rejects
 * parameters it cannot infer a type for).
 */
function selectStaffMessage(viewerParam: string): string {
  return `
  SELECT m.id,
         m.business_id,
         m.sender_id,
         m.subject,
         m.body,
         m.category,
         m.priority,
         m.created_at,
         m.updated_at,
         s.name AS sender_name,
         r.id AS recipient_row_id,
         r.is_read,
         r.read_at,
         r.is_starred,
         r.is_archived,
         (SELECT count(*) FROM staff_message_recipients rr WHERE rr.message_id = m.id)
           AS recipient_count
    FROM staff_messages m
    JOIN users s ON s.id = m.sender_id
    LEFT JOIN staff_message_recipients r
           ON r.message_id = m.id AND r.recipient_id = ${viewerParam}`;
}

/** Escape LIKE/ILIKE wildcards so a user searching "100%" matches literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Loads the messages visible to `viewerId` in `businessId` for the given
 * list filter, newest first.
 *
 * Filter semantics (mirrors the Staff Inbox tabs):
 *   all       — active received messages (not archived) + everything I sent
 *   inbox     — addressed to me, not archived
 *   sent      — sent by me (regardless of recipient state)
 *   unread    — addressed to me, unread, not archived
 *   important — addressed to me, starred, not archived
 *   archived  — addressed to me, archived
 *
 * Search (`q`) matches subject, body or sender name (case-insensitive).
 */
export async function listStaffMessages(
  viewerId: number,
  businessId: string,
  filter: SmListFilter,
  q: string
): Promise<StaffMessageRow[]> {
  // Parameter layout (every slot is referenced by the SQL text):
  //   $1 = business (always in the WHERE clause),
  //   $2 = viewer   (always in the LEFT JOIN; also the `sent` filter),
  //   $3+ = optional search pattern.
  const params: unknown[] = [businessId, viewerId];
  const where: string[] = ["m.business_id = $1"];

  switch (filter) {
    case "inbox":
      where.push("r.id IS NOT NULL", "r.is_archived = FALSE");
      break;
    case "sent":
      where.push("m.sender_id = $2");
      break;
    case "unread":
      where.push("r.id IS NOT NULL", "r.is_read = FALSE", "r.is_archived = FALSE");
      break;
    case "important":
      where.push("r.id IS NOT NULL", "r.is_starred = TRUE", "r.is_archived = FALSE");
      break;
    case "archived":
      where.push("r.id IS NOT NULL", "r.is_archived = TRUE");
      break;
    default:
      where.push(
        "(m.sender_id = $2 OR (r.id IS NOT NULL AND r.is_archived = FALSE))"
      );
  }

  const trimmed = q.trim();
  if (trimmed !== "") {
    params.push(likePattern(trimmed));
    where.push(
      `(m.subject ILIKE $${params.length}
        OR m.body ILIKE $${params.length}
        OR s.name ILIKE $${params.length})`
    );
  }

  const result = await pool.query<StaffMessageRow>(
    `${selectStaffMessage("$2")}
      WHERE ${where.join(" AND ")}
      ORDER BY m.created_at DESC, m.id DESC`,
    params
  );
  return result.rows;
}

/**
 * Loads ONE message of the authenticated business with the viewer's
 * recipient state, or null when it does not exist / belongs to another
 * business. Participant authorization (sender-or-recipient) is the caller's
 * responsibility.
 */
export async function loadStaffMessage(
  businessId: string,
  messageId: string,
  viewerId: number
): Promise<StaffMessageRow | null> {
  const result = await pool.query<StaffMessageRow>(
    `${selectStaffMessage("$3")}
      WHERE m.id = $1 AND m.business_id = $2
      LIMIT 1`,
    [messageId, businessId, viewerId]
  );
  return result.rows[0] ?? null;
}

/** True when `filter` is one of the supported list filters. */
export function isKnownFilter(value: string): value is SmListFilter {
  return (SM_LIST_FILTERS as readonly string[]).includes(value);
}
