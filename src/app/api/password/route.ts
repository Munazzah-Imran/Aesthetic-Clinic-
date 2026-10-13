import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { clearMustChangePassword } from "@/lib/staffDb";
import { validatePasswordChange } from "@/lib/settingsValidation";

export const dynamic = "force-dynamic";

/**
 * Change the authenticated user's password.
 *
 *   PATCH /api/password  { currentPassword, newPassword, confirmPassword }
 *
 * - The user id comes from the JWT only.
 * - The current password is verified against the stored bcrypt hash.
 * - The new password is stored ONLY as a bcrypt hash (cost 10, same as login
 *   and signup). Plain-text passwords are never stored or logged.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return NextResponse.json(
        { data: null, error: auth.message, success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validatePasswordChange({
      currentPassword: raw.currentPassword,
      newPassword: raw.newPassword,
      confirmPassword: raw.confirmPassword,
    });
    if (!validated.ok) {
      return NextResponse.json(
        {
          data: { errors: validated.errors },
          error: "Please fix the highlighted fields.",
          success: false,
          message: "Please fix the highlighted fields.",
        },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = validated.data;

    // Load the stored hash (never returned to the client).
    const result = await pool.query<{ password: string }>(
      "SELECT password FROM users WHERE id = $1 LIMIT 1",
      [auth.user.id]
    );
    const stored = result.rows[0];
    if (!stored) {
      return NextResponse.json(
        { data: null, error: "Account no longer exists", success: false, message: "Account no longer exists" },
        { status: 401 }
      );
    }

    const matches = await bcrypt.compare(currentPassword, stored.password);
    if (!matches) {
      return NextResponse.json(
        {
          data: { errors: { currentPassword: "Current password is incorrect." } },
          error: "Current password is incorrect.",
          success: false,
          message: "Current password is incorrect.",
        },
        { status: 400 }
      );
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, stored.password);
    if (sameAsCurrent) {
      return NextResponse.json(
        {
          data: { errors: { newPassword: "New password must be different from the current password." } },
          error: "New password must be different from the current password.",
          success: false,
          message: "New password must be different from the current password.",
        },
        { status: 400 }
      );
    }

    // Store ONLY the bcrypt hash (cost 10 — same as signup/login).
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $2 WHERE id = $1", [
      auth.user.id,
      hash,
    ]);

    // First-login password change complete: lift the forced-change gate so
    // the staff member's dashboard access is restored (no-op for users
    // without a staff membership, e.g. the admin/owner).
    await clearMustChangePassword(auth.user.id);

    return NextResponse.json({
      data: null,
      error: null,
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("PATCH /api/password failed:", error);
    return NextResponse.json(
      {
        data: null,
        error: "Internal server error",
        success: false,
        message: "Unable to change the password. Please try again.",
      },
      { status: 500 }
    );
  }
}
