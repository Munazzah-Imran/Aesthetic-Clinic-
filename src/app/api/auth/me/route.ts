import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type BusinessRow = {
  id: string;
  business_name: string;
  email: string;
};

export async function GET(request: Request) {
  try {
    // 1-3. Verify the existing JWT, re-read the user row from PostgreSQL and
    //      apply the account-status checks (requireAuth):
    //      - no/invalid token          -> 401
    //      - deactivated staff account -> 401 (session revoked)
    //      - forced password change    -> allowed here (identity needed by
    //        the password screen; module APIs stay blocked with 403).
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return NextResponse.json(
        {
          data: null,
          error: auth.message,
          success: false,
          message: auth.message,
        },
        { status: auth.status }
      );
    }
    const user = auth.user;

    // 4. Load the user's own business (never trust a client-sent businessId).
    let business: BusinessRow | null = null;
    if (user.business_id) {
      const businessResult = await pool.query<BusinessRow>(
        "SELECT id, business_name, email FROM business WHERE id = $1 LIMIT 1",
        [user.business_id]
      );
      business = businessResult.rows[0] ?? null;
    }

    // 5. Safe user + business info only — no password, no membership details,
    //    no secrets.
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
