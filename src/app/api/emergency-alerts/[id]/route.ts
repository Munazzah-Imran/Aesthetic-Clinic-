import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import {
  ALERT_ALLOWED_TRANSITIONS,
  ALERT_STATUS_LABELS,
  asAlertStatus,
  isValidAlertTransition,
  mapAlert,
  validateAlertPatch,
} from "@/lib/emergencyAlerts";
import { ensureEmergencyAlertTable, loadAlert } from "@/lib/emergencyAlertsDb";
import pool from "@/lib/db";

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
 * GET /api/emergency-alerts/[id]
 *
 * Returns ONE alert of the authenticated business (fresh details for the
 * view modal). Business isolation happens THROUGH business_id, so another
 * business's alert can never be read by changing the ID in the URL.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "emergency_alerts");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid alert id", 400);
    }

    await ensureEmergencyAlertTable();
    const row = await loadAlert(auth.user.business_id, id);
    if (!row) {
      return fail("Alert not found", 404);
    }

    return envelope(mapAlert(row), "Alert loaded");
  } catch (err) {
    console.error("GET /api/emergency-alerts/[id] failed:", err);
    return fail("Unable to load emergency alert", 500);
  }
}

/**
 * PATCH /api/emergency-alerts/[id]
 *
 * Advances ONE alert through its workflow
 * (new -> acknowledged -> in_progress -> resolved, with dismiss allowed
 * before resolution; resolved and dismissed are terminal). The transition
 * is validated SERVER-SIDE against the row's current status, so the API
 * cannot be bypassed from the browser.
 *
 * Business isolation happens THROUGH business_id: the UPDATE only matches
 * rows of the authenticated business, so another business's alert can never
 * be modified (and no new row is ever created on edit).
 *
 * Body: { status, resolutionNotes? }
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "emergency_alerts");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }
    const businessId = auth.user.business_id;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid alert id", 400);
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    // Only forward `resolutionNotes` when the client actually SENT the key:
    // building the object with the key always present would make an absent
    // key look like "clear the notes" and silently overwrite stored notes.
    const patchBody: { status?: unknown; resolutionNotes?: unknown } = {
      status: raw.status,
    };
    if (Object.prototype.hasOwnProperty.call(raw, "resolutionNotes")) {
      patchBody.resolutionNotes = raw.resolutionNotes;
    }
    const validated = validateAlertPatch(patchBody);
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

    await ensureEmergencyAlertTable();

    // Current status INSIDE the same transaction as the transition, so two
    // concurrent updates can never both pass the workflow check.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const current = await client.query<{ status: string }>(
        "SELECT status FROM emergency_alert WHERE id = $1 AND business_id = $2 FOR UPDATE",
        [id, businessId]
      );
      if ((current.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return fail("Alert not found", 404);
      }

      const currentStatus = current.rows[0].status;
      if (!isValidAlertTransition(currentStatus, v.status)) {
        await client.query("ROLLBACK");
        const allowed = ALERT_ALLOWED_TRANSITIONS[asAlertStatus(currentStatus)];
        const allowedLabels = allowed.map((s) => ALERT_STATUS_LABELS[s]).join(", ");
        return NextResponse.json(
          {
            data: { errors: { status: `Allowed next statuses: ${allowedLabels || "none"}.` } },
            error: "Invalid status transition",
            success: false,
            message: "That status change is not allowed from the current status.",
          },
          { status: 400 }
        );
      }

      // resolved_at is stamped when the alert reaches Resolved (terminal,
      // so it can never need clearing again). Resolution notes are only
      // written when the key was present in the payload.
      // The "is this the resolved status" test travels as its OWN boolean
      // parameter: reusing $1 there would make PostgreSQL deduce two types
      // for one parameter (varchar for SET vs text for the literal compare).
      const hasNotes = v.resolutionNotes !== undefined;
      const isResolved = v.status === "resolved";
      const updated = hasNotes
        ? await client.query(
            `UPDATE emergency_alert
                SET status = $1, resolution_notes = $2,
                    resolved_at = CASE WHEN $3::boolean THEN NOW() ELSE resolved_at END,
                    updated_at = NOW()
              WHERE id = $4 AND business_id = $5
              RETURNING id`,
            [v.status, v.resolutionNotes, isResolved, id, businessId]
          )
        : await client.query(
            `UPDATE emergency_alert
                SET status = $1,
                    resolved_at = CASE WHEN $2::boolean THEN NOW() ELSE resolved_at END,
                    updated_at = NOW()
              WHERE id = $3 AND business_id = $4
              RETURNING id`,
            [v.status, isResolved, id, businessId]
          );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return fail("Alert not found", 404);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const rowAfter = await loadAlert(businessId, id);
    if (!rowAfter) {
      return fail("Alert not found", 404);
    }

    return envelope(mapAlert(rowAfter), "Alert status updated.");
  } catch (err) {
    console.error("PATCH /api/emergency-alerts/[id] failed:", err);
    return fail("Unable to update emergency alert", 500);
  }
}
