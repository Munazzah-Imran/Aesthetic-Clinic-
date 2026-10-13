import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { signAuthToken } from "@/lib/jwt";
import { ensureStaffTables } from "@/lib/staffDb";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = {
  id: number;
  name: string;
  email: string;
  password: string;
  business_id: string | null;
};

function validate(
  email: unknown,
  password: unknown
): { ok: true; email: string; password: string } | { ok: false; message: string } {
  if (typeof email !== "string" || email.trim().length === 0) {
    return { ok: false, message: "Email is required" };
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, message: "Please enter a valid email address" };
  }

  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, message: "Password is required" };
  }

  return { ok: true, email: email.trim().toLowerCase(), password };
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);

    const raw = (body ?? {}) as {
      email?: unknown;
      password?: unknown;
    };

    const validated = validate(raw.email, raw.password);
    if (!validated.ok) {
      return NextResponse.json(
        { data: null, error: validated.message, success: false, message: validated.message },
        { status: 400 }
      );
    }

    const { email, password } = validated;

    // Find the user by email (parameterized query).
    const result = await pool.query<UserRow>(
      "SELECT id, name, email, password, business_id FROM users WHERE email = $1 LIMIT 1",
      [email]
    );
    const user = result.rows[0];

    // No account with this email — user must sign up first.
    if (!user) {
      return NextResponse.json(
        {
          data: null,
          error: "No account found with this email. Please sign up first.",
          success: false,
          message: "No account found with this email. Please sign up first.",
        },
        { status: 401 }
      );
    }

    // Compare the entered password against the stored bcrypt hash.
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return NextResponse.json(
        {
          data: null,
          error: "Incorrect password. Please try again.",
          success: false,
          message: "Incorrect password. Please try again.",
        },
        { status: 401 }
      );
    }

    // Deactivated staff may NOT log in — the status is re-read from the
    // database on every attempt (stateless JWTs cannot revoke themselves,
    // so the check lives here AND in requireAuth for existing tokens).
    // After consolidation the staff-account status lives on users.account_status
    // (staff rows have role='staff'); owners have role='admin' and are never
    // gated by this check (they set their password at signup).
    const membership = await pool.query<{ account_status: string; role: string | null }>(
      "SELECT account_status, role FROM users WHERE id = $1 LIMIT 1",
      [user.id]
    );
    const row = membership.rows[0];
    if (row && row.role === "staff" && row.account_status === "inactive") {
      return NextResponse.json(
        {
          data: null,
          error: "Your account has been deactivated. Please contact the administrator.",
          success: false,
          message: "Your account has been deactivated. Please contact the administrator.",
        },
        { status: 403 }
      );
    }

    // Issue a JWT containing the user's id, email, and business relationship.
    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      businessId: user.business_id,
    });

    return NextResponse.json(
      {
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            business_id: user.business_id,
          },
          token,
        },
        error: null,
        success: true,
        message: "Login successful",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/auth/login failed:", err);
    return NextResponse.json(
      {
        data: null,
        error: "Internal server error",
        success: false,
        message: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }
}
