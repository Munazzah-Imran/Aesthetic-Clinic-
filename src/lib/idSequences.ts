import type { PoolClient } from "pg";

/**
 * Two COMPLETELY INDEPENDENT PostgreSQL sequences drive the human-readable
 * business IDs:
 *
 *   patient_id_sequence      START 1    -> PT-YYYYMMDD-0001, PT-YYYYMMDD-0002, ...
 *   appointment_id_sequence  START 5001 -> APT-YYYYMMDD-5001, APT-YYYYMMDD-5002, ...
 *
 * Because the two ranges can never overlap, a patient and an appointment
 * created on the same date NEVER share the same numeric suffix.
 *
 * Rules honoured here:
 *   - Never SELECT COUNT(*): COUNT(*) races under concurrency.
 *   - Never Math.random(): IDs must be deterministic and gap-free-ish.
 *   - The ID is always generated on the BACKEND, inside the same transaction
 *     as the insert (see src/lib/sequentialId.ts).
 *   - Existing records are never touched: before a sequence is first used we
 *     inspect the IDs already stored for TODAY and fast-forward the sequence
 *     past them, so a new ID can never duplicate an existing one. The
 *     fast-forward is monotonic (never rewinds a sequence that is already
 *     ahead), so re-running the bootstrap is always safe.
 */

export type IdPrefix = "PT" | "APT";

export type IdSequenceConfig = {
  /** PostgreSQL sequence name (global, independent per ID type). */
  sequence: string;
  /** Table holding the human-readable ID column. */
  table: "patient" | "appointment";
  /** Human-readable ID column in that table. */
  idColumn: "patient_id" | "appointment_id";
  /** First value the sequence may ever return. */
  start: number;
};

export const ID_SEQUENCE_CONFIG: Record<IdPrefix, IdSequenceConfig> = {
  PT: {
    sequence: "patient_id_sequence",
    table: "patient",
    idColumn: "patient_id",
    start: 1,
  },
  APT: {
    sequence: "appointment_id_sequence",
    table: "appointment",
    idColumn: "appointment_id",
    start: 5001,
  },
};

/** Anything that can run a parameterized query (Pool or transaction client). */
export type SequenceClient = Pick<PoolClient, "query">;

/**
 * Fixed advisory-lock key used ONLY to serialize the one-time bootstrap
 * (CREATE SEQUENCE + inspect existing IDs) across concurrent processes.
 * It is transaction-scoped, so it is released automatically on COMMIT.
 */
const BOOTSTRAP_LOCK_KEY = 913_202_601;

/** Server-side "YYYYMMDD" stamp for the ID date part (never the browser's). */
export function serverDateStamp(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

/**
 * Creates the two sequences if missing and advances them past any ID that
 * already exists for `dateStamp`. MUST run inside the caller's transaction
 * (it uses a transaction-scoped advisory lock and COMMIT/ROLLBACK belong to
 * the caller).
 *
 * Forward-only: the new position is `GREATEST(current position, start,
 * existing same-day max + 1)`, so it can never rewind a sequence that other
 * traffic has already consumed.
 */
export async function ensureIdSequences(
  client: SequenceClient,
  dateStamp: string = serverDateStamp()
): Promise<void> {
  // Serialize first-time bootstrap across processes; held until the
  // surrounding transaction commits.
  await client.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK_KEY]);

  await client.query("CREATE SEQUENCE IF NOT EXISTS patient_id_sequence START 1");
  await client.query("CREATE SEQUENCE IF NOT EXISTS appointment_id_sequence START 5001");

  for (const prefix of Object.keys(ID_SEQUENCE_CONFIG) as IdPrefix[]) {
    const cfg = ID_SEQUENCE_CONFIG[prefix];
    const like = `${prefix}-${dateStamp}-%`;

    // One statement = one snapshot: the sequence's next value plus the
    // highest numeric suffix already stored for TODAY (existing records are
    // inspected, never modified or deleted).
    const result = await client.query<{ next_value: string; today_max: string | null }>(
      `SELECT
         CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next_value,
         (
           SELECT MAX(NULLIF(regexp_replace(${cfg.idColumn}, '^.*-', ''), '')::int)
             FROM ${cfg.table}
            WHERE ${cfg.idColumn} LIKE $1
         ) AS today_max
       FROM ${cfg.sequence}`,
      [like]
    );

    const nextValue = Number(result.rows[0]?.next_value ?? cfg.start);
    const rawMax = result.rows[0]?.today_max;
    const todayMax = rawMax === null || rawMax === undefined ? 0 : Number(rawMax);

    // Next number must respect the configured start AND skip past every
    // existing same-day ID so it can never duplicate one.
    const target = Math.max(cfg.start, nextValue, todayMax + 1);
    if (target > nextValue) {
      await client.query("SELECT setval($1::regclass, $2, true)", [
        cfg.sequence,
        target - 1,
      ]);
    }
  }
}
