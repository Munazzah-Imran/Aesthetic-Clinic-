import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env or run via docker compose."
    );
  }

  return new Pool({
    connectionString,
    // When running the app on the host against the compose Postgres (npm run dev),
    // the db hostname resolves to localhost. Inside Docker the service name is `db`.
    ...(connectionString.includes("@db:")
      ? { ssl: false }
      : {}),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Reuse a single Pool across hot reloads in development and across
 * requests in production. Pools manage their own connections.
 */
const pool: Pool = global.__pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

export default pool;
