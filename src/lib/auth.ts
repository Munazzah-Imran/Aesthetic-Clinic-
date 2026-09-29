import pool from "@/lib/db";
import { verifyAuthToken } from "@/lib/jwt";

/**
 * Server-only helper: authenticate a request via the existing JWT
 * (Authorization: Bearer <token>) and resolve the user's business.
 *
 * The businessId ALWAYS comes from the database via users.business_id —
 * never from the request body or query string.
 */

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  business_id: string | null;
};


export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: 401; message: string };

export async function requireAuth(request: Request): Promise<AuthResult> {
  // 1. Extract Bearer token.
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false, status: 401, message: "Not authenticated" };
  }

  // 2. Verify via the existing JWT utility.
  const payload = verifyAuthToken(token);
  if (!payload) {
    return { ok: false, status: 401, message: "Invalid or expired token" };
  }

  // 3. Load the user (and their business_id) from the database.
  const result = await pool.query<AuthUser>(
    "SELECT id, name, email, business_id FROM users WHERE id = $1 LIMIT 1",
    [payload.sub]
  );
  const user = result.rows[0];
  if (!user) {
    return { ok: false, status: 401, message: "Account no longer exists" };
  }

  return { ok: true, user };
}
