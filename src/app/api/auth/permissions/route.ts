import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { loadAuthContext } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/permissions
 *
 * Returns the CURRENT user's role and dashboard permissions exactly as the
 * server resolves them from PostgreSQL (never anything sent by the client):
 *
 *   {
 *     role: "admin" | "staff",
 *     isAdmin: boolean,
 *     permissions: ["overview", "clinics", ...],   // admins: every key
 *     mustChangePassword: boolean,
 *     designation: string | null,
 *     staffId: string | null,
 *     membershipId: string | null
 *   }
 *
 * Deactivated staff never reach this endpoint: requireAuth rejects them
 * with 401 first.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return NextResponse.json(
        { data: null, error: auth.message, success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const resolved = await loadAuthContext(auth.user);
    if (!resolved.ok) {
      return NextResponse.json(
        { data: null, error: resolved.message, success: false, message: resolved.message },
        { status: resolved.status }
      );
    }

    const ctx = resolved.ctx;
    return NextResponse.json(
      {
        data: {
          role: ctx.role,
          isAdmin: ctx.isAdmin,
          permissions: ctx.permissions,
          mustChangePassword: ctx.mustChangePassword,
          designation: ctx.designation,
          staffId: ctx.staffId,
          membershipId: ctx.membershipId,
        },
        error: null,
        success: true,
        message: "Permissions loaded",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/auth/permissions failed:", err);
    return NextResponse.json(
      {
        data: null,
        error: "Internal server error",
        success: false,
        message: "Unable to load permissions",
      },
      { status: 500 }
    );
  }
}
