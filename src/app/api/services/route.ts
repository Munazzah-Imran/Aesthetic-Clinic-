import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission, SERVICE_READERS } from "@/lib/rbac";
import { mapService, validateService } from "@/lib/services";
import { ensureServiceTable, loadServices } from "@/lib/servicesDb";

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
 * GET /api/services
 *
 * Returns every service/treatment of the authenticated business:
 *
 *   {
 *     success: true,
 *     data: [
 *       { id, serviceTitle, category, status, createdAt, updatedAt },
 *       ...
 *     ]
 *   }
 *
 * Business isolation: the business id comes from the authenticated user
 * (JWT -> users.business_id), never from the request.
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, SERVICE_READERS);
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

    const rows = await loadServices(auth.user.business_id);
    return envelope(rows.map(mapService), "Services loaded");
  } catch (err) {
    console.error("GET /api/services failed:", err);
    return envelope(null, "Unable to load services", false, "Unable to load services", 500);
  }
}

/**
 * POST /api/services
 *
 * Creates ONE service for the authenticated business.
 *
 * Body: { serviceTitle, category, status? }
 *
 * business_id is taken from the JWT — never from the body.
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "services");
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

    const validated = validateService({
      serviceTitle: raw.serviceTitle,
      category: raw.category,
      status: raw.status,
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

    await ensureServiceTable();

    const insert = await pool.query(
      `INSERT INTO service (business_id, service_title, category, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_id, service_title, category, status,
                 created_at, updated_at`,
      [auth.user.business_id, v.serviceTitle, v.category, v.status]
    );

    return envelope(mapService(insert.rows[0]), "Service added.", true, null, 201);
  } catch (err) {
    console.error("POST /api/services failed:", err);
    return envelope(null, "Unable to add service", false, "Unable to add service", 500);
  }
}
