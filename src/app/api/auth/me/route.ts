import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifyAuthToken } from "@/lib/jwt";

export const dynamic = "force-dynamic";

type UserRow = {
  id: number;
  name: string;
  email: string;
  business_id: string | null;
};

type BusinessRow = {
  id: string;
  business_name: string;
  email: string;
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function GET(request: Request) {
  try {
    // 1. Verify the existing JWT (Authorization: Bearer <token>).
    const token = bearerToken(request);
    const payload = token ? verifyAuthToken(token) : null;
    if (!payload) {
      return NextResponse.json(
        {
          data: null,
          error: "Not authenticated",
          success: false,
          message: "Not authenticated",
        },
        { status: 401 }
      );
    }

    // 2-3. Identify the authenticated user from the JWT (server-side only).
    const userResult = await pool.query<UserRow>(
      "SELECT id, name, email, business_id FROM users WHERE id = $1 LIMIT 1",
      [payload.sub]
    );
    const user = userResult.rows[0];
    if (!user) {
      return NextResponse.json(
        {
          data: null,
          error: "Account no longer exists",
          success: false,
          message: "Account no longer exists",
        },
        { status: 401 }
      );
    }

    // 4. Load the user's own business (never trust a client-sent businessId).
    let business: BusinessRow | null = null;
    if (user.business_id) {
      const businessResult = await pool.query<BusinessRow>(
        "SELECT id, business_name, email FROM business WHERE id = $1 LIMIT 1",
        [user.business_id]
      );
      business = businessResult.rows[0] ?? null;
    }

    // 5. Safe user + business info only — no password, no secrets.
    return NextResponse.json(
      {
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            business_id: user.business_id,
          },
          business,
        },
        error: null,
        success: true,
        message: "Authenticated user",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/auth/me failed:", err);
    return NextResponse.json(
      {
        data: null,
        error: "Internal server error",
        success: false,
        message: "Unable to load clinic information",
      },
      { status: 500 }
    );
  }
}
