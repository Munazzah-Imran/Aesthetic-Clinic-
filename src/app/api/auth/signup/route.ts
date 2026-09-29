import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type BusinessRow = {
  id: string;
  business_name: string;
  email: string;
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  business_id: string | null;
};

function validate(
  businessName: unknown,
  name: unknown,
  email: unknown,
  password: unknown
): {
  ok: true;
  businessName: string;
  name: string;
  email: string;
  password: string;
} | { ok: false; message: string } {
  if (typeof businessName !== "string" || businessName.trim().length === 0) {
    return { ok: false, message: "Business name is required" };
  }
  if (businessName.trim().length > 255) {
    return { ok: false, message: "Business name must be 255 characters or fewer" };
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, message: "Name is required" };
  }
  if (name.trim().length > 100) {
    return { ok: false, message: "Name must be 100 characters or fewer" };
  }

  if (typeof email !== "string" || email.trim().length === 0) {
    return { ok: false, message: "Email is required" };
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, message: "Please enter a valid email address" };
  }

  if (typeof password !== "string" || password.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters" };
  }
  if (password.length > 72) {
    return { ok: false, message: "Password must be 72 characters or fewer" };
  }

  return {
    ok: true,
    businessName: businessName.trim(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
  };
}

/** Map raw PostgreSQL errors to a safe public message + status. */
function mapDbError(err: unknown): { status: number; message: string } | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: string }).code;
  if (code === "23505") {
    // Unique violation on business.email or users.email.
    return { status: 409, message: "Email already exists" };
  }
  if (code === "23503") {
    // Foreign-key violation (should not happen inside the transaction).
    return { status: 400, message: "Invalid business reference" };
  }
  return null;
}

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  try {
    const body: unknown = await request.json().catch(() => null);

    const raw = (body ?? {}) as {
      businessName?: unknown;
      name?: unknown;
      email?: unknown;
      password?: unknown;
    };

    const validated = validate(raw.businessName, raw.name, raw.email, raw.password);
    if (!validated.ok) {
      return NextResponse.json(
        { data: null, error: validated.message, success: false, message: validated.message },
        { status: 400 }
      );
    }

    const { businessName, name, email, password } = validated;

    // Friendly pre-check outside the transaction (best effort).
    const existing = await pool.query(
      "SELECT 1 FROM users WHERE email = $1 LIMIT 1",
      [email]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return NextResponse.json(
        {
          data: null,
          error: "An account with this email already exists",
          success: false,
          message: "Email already exists",
        },
        { status: 409 }
      );
    }

    // Store only the bcrypt hash, never the plain-text password.
    const passwordHash = await bcrypt.hash(password, 10);

    // ---- Transaction: business + user are created together, or not at all ----
    client = await pool.connect();
    await client.query("BEGIN");

    // STEP 1: create the business; PostgreSQL generates the UUID.
    const businessResult = await client.query<BusinessRow>(
      "INSERT INTO business (business_name, email) VALUES ($1, $2) RETURNING id, business_name, email",
      [businessName, email]
    );
    const business = businessResult.rows[0];

    // STEP 2: create the user with the exact UUID returned above.
    const userResult = await client.query<UserRow>(
      "INSERT INTO users (name, email, password, business_id) VALUES ($1, $2, $3, $4) RETURNING id, name, email, business_id",
      [name, email, passwordHash, business.id]
    );
    const user = userResult.rows[0];

    await client.query("COMMIT");
    // --------------------------------------------------------------------------

    return NextResponse.json(
      {
        data: {
          user,
          business,
        },
        error: null,
        success: true,
        message: "Business account created successfully",
      },
      { status: 201 }
    );
  } catch (err) {
    // Anything failed -> roll back so no business/user half-record remains.
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Signup ROLLBACK failed:", rollbackErr);
      }
    }

    const mapped = mapDbError(err);
    if (mapped) {
      return NextResponse.json(
        {
          data: null,
          error: mapped.message,
          success: false,
          message: mapped.message,
        },
        { status: mapped.status }
      );
    }

    console.error("POST /api/auth/signup failed:", err);
    return NextResponse.json(
      {
        data: null,
        error: "Internal server error",
        success: false,
        message: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
