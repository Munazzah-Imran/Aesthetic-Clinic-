import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { validateBlockedSlot, type ClinicBlockedSlot } from "@/lib/blockedSlots";
import {
  ensureClinicBlockedSlotTable,
  hasOverlappingBlockedSlot,
  loadBlockedSlotsByClinic,
} from "@/lib/blockedSlotsDb";

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
 * GET /api/blocked-slots
 *
 * Returns EVERY clinic of the authenticated business together with its
 * blocked slots (time ranges that cannot be booked):
 *
 *   {
 *     success: true,
 *     data: [
 *       {
 *         clinic: { id, clinic_name, city, status },
 *         slots: [ { id, clinic_id, block_date: "2026-12-25",
 *                    start_time: "13:00", end_time: "14:00", reason: "..." } ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Business isolation: the business id comes from the authenticated user
 * (JWT -> users.business_id), never from the request.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "blocked_slots");
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

    const data = await loadBlockedSlotsByClinic(auth.user.business_id);

    return envelope(data, "Blocked slots loaded");
  } catch (err) {
    console.error("GET /api/blocked-slots failed:", err);
    return envelope(null, "Unable to load blocked slots", false, "Unable to load blocked slots", 500);
  }
}

/**
 * POST /api/blocked-slots
 *
 * Blocks ONE time range on ONE date for ONE clinic.
 *
 * Body: { clinicId: "<uuid>", blockDate: "YYYY-MM-DD",
 *         startTime: "HH:MM", endTime: "HH:MM", reason?: "..." }
 *
 * Business isolation: the target clinic must belong to the authenticated
 * business (business id comes from the JWT, never from the body). Ranges
 * that overlap an existing block for the same clinic + date are rejected
 * so blocks stay unambiguous.
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "blocked_slots");
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

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateBlockedSlot({
      clinicId: raw.clinicId,
      blockDate: raw.blockDate,
      startTime: raw.startTime,
      endTime: raw.endTime,
      reason: raw.reason,
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

    await ensureClinicBlockedSlotTable();

    // Business isolation: only clinics owned by the authenticated business.
    const clinic = await pool.query(
      "SELECT id FROM clinic WHERE id = $1 AND business_id = $2",
      [v.clinicId, auth.user.business_id]
    );
    if ((clinic.rowCount ?? 0) === 0) {
      return NextResponse.json(
        {
          data: { errors: { clinicId: "Clinic not found." } },
          error: "Clinic not found",
          success: false,
          message: "Clinic not found.",
        },
        { status: 400 }
      );
    }

    // Overlap guard: two blocks for the same clinic + date must never
    // cover the same minute (otherwise "which block applies?" is ambiguous).
    if (await hasOverlappingBlockedSlot(v.clinicId, v.blockDate, v.startTime, v.endTime)) {
      const message =
        "This time range already overlaps a blocked slot for this clinic on that date.";
      return NextResponse.json(
        {
          data: { errors: { startTime: message, endTime: message } },
          error: message,
          success: false,
          message,
        },
        { status: 409 }
      );
    }

    const insert = await pool.query<ClinicBlockedSlot>(
      `INSERT INTO clinic_blocked_slot (clinic_id, block_date, start_time, end_time, reason)
       VALUES ($1, $2::date, $3::time, $4::time, $5)
       RETURNING id, clinic_id,
                 TO_CHAR(block_date, 'YYYY-MM-DD') AS block_date,
                 TO_CHAR(start_time, 'HH24:MI') AS start_time,
                 TO_CHAR(end_time, 'HH24:MI') AS end_time,
                 reason`,
      [v.clinicId, v.blockDate, v.startTime, v.endTime, v.reason]
    );

    return envelope(insert.rows[0], "Blocked slot added.", true, null, 201);
  } catch (err) {
    // Duplicate (clinic, date, start, end) — unique violation, mapped without leaking DB errors.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      const message = "This clinic already has that exact blocked slot.";
      return NextResponse.json(
        {
          data: { errors: { startTime: message, endTime: message } },
          error: message,
          success: false,
          message,
        },
        { status: 409 }
      );
    }

    console.error("POST /api/blocked-slots failed:", err);
    return envelope(null, "Unable to add blocked slot", false, "Unable to add blocked slot", 500);
  }
}
