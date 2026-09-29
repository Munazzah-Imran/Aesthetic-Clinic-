import jwt from "jsonwebtoken";

/**
 * Server-only helpers for signing and verifying JWTs.
 * Never import this file from client components.
 */

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "JWT_SECRET is not set. Add JWT_SECRET=<strong-random-value> to .env (or the compose environment)."
    );
  }
  return secret;
}

export type AuthTokenPayload = {
  sub: number;
  email: string;
  businessId?: string | null;
};

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === "object" && decoded !== null) {
      const { sub, email, businessId } = decoded as jwt.JwtPayload;
      if (typeof sub === "number" && typeof email === "string") {
        return {
          sub,
          email,
          businessId: typeof businessId === "string" ? businessId : null,
        };
      }
    }
    return null;
  } catch {
    // Invalid, expired, or malformed token.
    return null;
  }
}
