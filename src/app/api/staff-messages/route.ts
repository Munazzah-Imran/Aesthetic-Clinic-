import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import {
  mapStaffMessage,
  validateSend,
} from "@/lib/staffMessages";
import {
  isKnownFilter,
  listStaffMessages,
  loadStaffMessage,
} from "@/lib/staffMessagesDb";

export const dynamic = "force-dynamic";

function envelope(
  data: unknown,
  message: string,
  success = true,
  error: string | null = null,
  status = 200
) {
  return NextResponse.json({ data, error, success, message }, { status });
}

/**
 * GET /api/staff-messages
 *
 * Returns the authenticated staff member's messages (newest first).
 *
 * Query parameters:
 *   filter = all | inbox | sent | unread | important | archived  (default all)
 *   q      = free-text search over subject, body and sender name
 *
 * The viewer id AND business id come exclusively from the verified JWT ->
 * users row (requireAuth); a client-supplied id is never used for
 * authorization. Sender name is read through a JOIN (password never
 * selected) and each row carries the viewer's own read/star/archive state.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "staff_inbox");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(
        null,
        "No business associated with this account",
        false,
        "No business associated with this account",
        400
      );
    }

    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get("filter") ?? "all").trim().toLowerCase();
    if (!isKnownFilter(filter)) {
      return envelope(null, "Invalid filter", false, "Invalid filter", 400);
    }
    const q = searchParams.get("q") ?? "";

    const rows = await listStaffMessages(
      auth.user.id,
      auth.user.business_id,
      filter,
      q
    );
    return envelope(
      rows.map((row) => mapStaffMessage(row, auth.user.id)),
      "Messages loaded"
    );
  } catch (err) {
    console.error("GET /api/staff-messages failed:", err);
    const missing =
      err instanceof Error && err.message.includes("staff_messages");
    const message = missing
      ? "Staff Inbox schema is missing — run npm run db:migrate:staff-inbox"
      : "Unable to load messages";
    return envelope(null, message, false, message, 500);
  }
}

/**
 * POST /api/staff-messages
 *
 * Sends ONE internal message to one or more staff members of the SAME
 * business.
 *
 * Body: { subject, body, category?, priority?, recipientIds: number[] }
 *   - sender id + business id come from requireAuth() only;
 *   - every recipient must be an existing users row of this business
 *     (verified in SQL — another business's accounts are rejected);
 *   - message + ALL recipient rows are written in ONE transaction, so a
 *     failed send can never leave a partial message.
 *
 * Returns 201 with the created message (viewer perspective), or 400 with
 * per-field errors in data.errors.
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "staff_inbox");
    if (!auth.ok) {
      return envelope(null, auth.message, false, auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return envelope(
        null,
        "No business associated with this account",
        false,
        "No business associated with this account",
        400
      );
    }
    const businessId = auth.user.business_id;
    const senderId = auth.user.id;

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateSend({
      subject: raw.subject,
      body: raw.body,
      category: raw.category,
      priority: raw.priority,
      recipientIds: raw.recipientIds,
    });
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
    const v = validated.data;

    // Ownership: every recipient must be an EXISTING staff account of THIS
    // business (ids from the request are never trusted). Any unknown id
    // rejects the whole send — no partial delivery.
    const eligible = await pool.query<{ id: number }>(
      "SELECT id FROM users WHERE id = ANY($1::int[]) AND business_id = $2",
      [v.recipientIds, businessId]
    );
    const eligibleIds = new Set(eligible.rows.map((r) => r.id));
    const missing = v.recipientIds.filter((id) => !eligibleIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          data: {
            errors: {
              recipientIds:
                "One or more recipients do not exist in your business.",
            },
          },
          error: "Validation failed",
          success: false,
          message: "One or more recipients do not exist in your business.",
        },
        { status: 400 }
      );
    }

    // Message + recipients in ONE transaction: partial sends are impossible.
    const client = await pool.connect();
    let messageId: string;
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO staff_messages
           (business_id, sender_id, subject, body, category, priority)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [businessId, senderId, v.subject, v.body, v.category, v.priority]
      );
      messageId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO staff_message_recipients (message_id, recipient_id)
         SELECT $1, unnest($2::int[])`,
        [messageId, v.recipientIds]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const row = await loadStaffMessage(businessId, messageId, senderId);
    if (!row) {
      return envelope(null, "Unable to send message", false, "Unable to send message", 500);
    }

    return envelope(mapStaffMessage(row, senderId), "Message sent.", true, null, 201);
  } catch (err) {
    console.error("POST /api/staff-messages failed:", err);
    const missing =
      err instanceof Error && err.message.includes("staff_messages");
    const message = missing
      ? "Staff Inbox schema is missing — run npm run db:migrate:staff-inbox"
      : "Unable to send message";
    return envelope(null, message, false, message, 500);
  }
}
