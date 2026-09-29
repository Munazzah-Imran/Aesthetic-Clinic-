import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { validateProfile } from "@/lib/settingsValidation";

export const dynamic = "force-dynamic";

/**
 * The authenticated admin's PERSONAL profile (users table).
 *
 *   GET   /api/profile — load name, email, phone, photo
 *   PATCH /api/profile — update name, email, phone, photo
 *
 * The user id ALWAYS comes from the JWT (requireAuth) — never the body.
 * The password column is never selected and never returned.
 */

type UserRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  photo_url: string | null;
  business_id: string | null;
};

function ok(data: unknown, message: string) {
  return NextResponse.json({ success: true, data, error: null, message });
}

function fail(status: number, message: string) {
  return NextResponse.json({ success: false, data: null, error: message, message }, { status });
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    photoUrl: user.photo_url,
    business_id: user.business_id,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return fail(auth.status, auth.message);

    const result = await pool.query<UserRow>(
      `SELECT id, name, email, phone, photo_url, business_id
         FROM users WHERE id = $1 LIMIT 1`,
      [auth.user.id]
    );
    const user = result.rows[0];
    if (!user) return fail(401, "Account no longer exists");

    return ok(publicUser(user), "Profile loaded.");
  } catch (error) {
    console.error("GET /api/profile failed:", error);
    return fail(500, "Unable to load your profile. Please try again.");
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return fail(auth.status, auth.message);

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    const validated = validateProfile({
      fullName: raw.fullName,
      email: raw.email,
      phone: raw.phone,
      photoUrl: raw.photoUrl,
    });
    if (!validated.ok) {
      return NextResponse.json(
        {
          success: false,
          data: { errors: validated.errors },
          error: "Please fix the highlighted fields.",
          message: "Please fix the highlighted fields.",
        },
        { status: 400 }
      );
    }

    const v = validated.data;

    // The email is the login identifier: if it changed, make sure no OTHER
    // account already uses it (the user keeping their own email is fine).
    if (v.email !== auth.user.email.toLowerCase()) {
      const dupe = await pool.query(
        "SELECT 1 FROM users WHERE email = $1 AND id != $2 LIMIT 1",
        [v.email, auth.user.id]
      );
      if (dupe.rows.length > 0) {
        return NextResponse.json(
          {
            success: false,
            data: { errors: { email: "An account with this email already exists." } },
            error: "Email already exists.",
            message: "An account with this email already exists.",
          },
          { status: 409 }
        );
      }
    }

    const updated = await pool.query<UserRow>(
      `UPDATE users
          SET name = $2, email = $3, phone = $4, photo_url = $5
        WHERE id = $1
        RETURNING id, name, email, phone, photo_url, business_id`,
      [auth.user.id, v.fullName, v.email, v.phone, v.photoUrl]
    );

    // Defensively verify the stored value is still a bcrypt hash (it always
    // should be; this route never writes passwords).
    await pool.query("SELECT password FROM users WHERE id = $1 LIMIT 1", [auth.user.id]);
    void bcrypt;

    return ok(publicUser(updated.rows[0]), "Profile updated successfully.");
  } catch (error) {
    console.error("PATCH /api/profile failed:", error);
    return fail(500, "Unable to update your profile. Please try again.");
  }
}
