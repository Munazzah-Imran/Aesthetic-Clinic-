import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { mapStaffMessage, validateStatusPatch } from "@/lib/staffMessages";
import { loadStaffMessage } from "@/lib/staffMessagesDb";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

function envelope(
  data: unknown,
  message: string,
  success = true,
  error: string | null = null,
  status = 200
) {
  return NextResponse.json({ data, error, success, message }, { status });
}

function fail(message: string, status: number) {
  return envelope(null, message, false, message, status);
}

/**
 * GET /api/staff-messages/[id]
 *
 * Returns ONE message, but only when the authenticated user is a
 * participant: the sender or one of the recipients. Everyone else — inside
 * or outside the business — gets 404 so existence is never leaked, and the
 * business id always comes from requireAuth(), never from the request.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "staff_inbox");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid message id", 400);
    }

    const row = await loadStaffMessage(auth.user.business_id, id, auth.user.id);
    // Participant = sender OR my recipient row exists.
    if (!row || (row.sender_id !== auth.user.id && !row.recipient_row_id)) {
      return fail("Message not found", 404);
    }

    return envelope(mapStaffMessage(row, auth.user.id), "Message loaded");
  } catch (err) {
    console.error("GET /api/staff-messages/[id] failed:", err);
    const message =
      err instanceof Error && err.message.includes("staff_messages")
        ? "Staff Inbox schema is missing — run npm run db:migrate:staff-inbox"
        : "Unable to load message";
    return fail(message, 500);
  }
}

/**
 * PATCH /api/staff-messages/[id]
 *
 * Updates the VIEWER's own recipient status: read (sets/clears read_at),
 * starred, archived.
 *
 * Authorization, in order:
 *   - not in my business / unknown id        -> 404 (no existence leak);
 *   - participant but NOT a recipient (the
 *     sender of a message they did not send
 *     to themselves)                         -> 403 (a sender can never
 *                                               modify recipient state);
 *   - not a participant at all               -> 404;
 *   - recipient                               -> UPDATE restricted to
 *                                               (message_id, recipient_id=me),
 *   so another user's recipient row can never be touched.
 *
 * Body: { isRead?, isStarred?, isArchived? } — partial, booleans only.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "staff_inbox");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid message id", 400);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateStatusPatch(raw);
    // The RAW body is passed straight through: a key that is absent from the
    // payload must stay absent (it is never applied), while a present-but-
    // non-boolean value is rejected.
    if (!validated.ok) {
      return NextResponse.json(
        {
          data: { errors: validated.errors },
          error: "Validation failed",
          success: false,
          message: "Please fix the highlighted fields.",
        },
        { status: 400 }
      );
    }
    const patch = validated.data;

    const row = await loadStaffMessage(auth.user.business_id, id, auth.user.id);
    if (!row || (row.sender_id !== auth.user.id && !row.recipient_row_id)) {
      return fail("Message not found", 404);
    }
    if (!row.recipient_row_id) {
      // sender without a recipient row: participant, but wrong role
      return fail(
        "Only recipients can update read, star or archive status.",
        403
      );
    }

    // Build the SET clause from the provided keys only (booleans, all
    // parameterized). read_at follows is_read: stamped on first mark-read,
    // cleared when marked unread.
    const sets: string[] = [];
    const queryParams: unknown[] = [];
    if (typeof patch.isRead === "boolean") {
      queryParams.push(patch.isRead);
      sets.push(`is_read = $${queryParams.length}`);
      sets.push(
        patch.isRead ? "read_at = COALESCE(read_at, NOW())" : "read_at = NULL"
      );
    }
    if (typeof patch.isStarred === "boolean") {
      queryParams.push(patch.isStarred);
      sets.push(`is_starred = $${queryParams.length}`);
    }
    if (typeof patch.isArchived === "boolean") {
      queryParams.push(patch.isArchived);
      sets.push(`is_archived = $${queryParams.length}`);
    }
    queryParams.push(id, auth.user.id);

    const updated = await pool.query(
      `UPDATE staff_message_recipients
          SET ${sets.join(", ")}
        WHERE message_id = $${queryParams.length - 1}
          AND recipient_id = $${queryParams.length}
        RETURNING id`,
      queryParams
    );
    if ((updated.rowCount ?? 0) === 0) {
      return fail("Message not found", 404);
    }

    const fresh = await loadStaffMessage(auth.user.business_id, id, auth.user.id);
    if (!fresh) {
      return fail("Message not found", 404);
    }

    return envelope(mapStaffMessage(fresh, auth.user.id), "Message updated.");
  } catch (err) {
    console.error("PATCH /api/staff-messages/[id] failed:", err);
    const message =
      err instanceof Error && err.message.includes("staff_message_recipients")
        ? "Staff Inbox schema is missing — run npm run db:migrate:staff-inbox"
        : "Unable to update message";
    return fail(message, 500);
  }
}
