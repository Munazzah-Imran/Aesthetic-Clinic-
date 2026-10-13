import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { mapService, validateService, type ServiceRow } from "@/lib/services";
import { ensureServiceTable } from "@/lib/servicesDb";

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
 * PATCH /api/services/[id]
 *
 * Updates ONE existing service (title, category, status). Business
 * isolation happens THROUGH business_id: the UPDATE only matches rows of
 * the authenticated business, so another business's service can never be
 * edited (and no new row is ever created on edit).
 *
 * Body: { serviceTitle, category, status }
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "services");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid service id", 400);
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

    const result = await pool.query<ServiceRow>(
      `UPDATE service SET
         service_title = $1,
         category = $2,
         status = $3,
         updated_at = NOW()
       WHERE id = $4 AND business_id = $5
       RETURNING id, business_id, service_title, category, status,
                 created_at, updated_at`,
      [v.serviceTitle, v.category, v.status, id, auth.user.business_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      return fail("Service not found", 404);
    }

    return envelope(mapService(result.rows[0]), "Service updated.");
  } catch (err) {
    console.error("PATCH /api/services/[id] failed:", err);
    return fail("Unable to update service", 500);
  }
}

/**
 * DELETE /api/services/[id]
 *
 * Removes ONE service. Business isolation happens THROUGH business_id, so
 * another business's service can never be deleted. Unrelated services are
 * unaffected.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requirePermission(request, "services");
    if (!auth.ok) {
      return fail(auth.message, auth.status);
    }
    if (!auth.user.business_id) {
      return fail("No business associated with this account", 400);
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return fail("Invalid service id", 400);
    }

    await ensureServiceTable();

    const result = await pool.query(
      "DELETE FROM service WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, auth.user.business_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      return fail("Service not found", 404);
    }

    return envelope({ id }, "Service removed.");
  } catch (err) {
    console.error("DELETE /api/services/[id] failed:", err);
    return fail("Unable to remove service", 500);
  }
}
