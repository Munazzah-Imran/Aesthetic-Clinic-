import type { PoolClient } from "pg";

/**
 * One PostgreSQL sequence per ID type drives the human-readable business IDs:
 *
 *   patient_id_sequence           START 1    -> PT-YYYYMMDD-0001, PT-YYYYMMDD-0002, ...
 *   appointment_id_sequence       START 5001 -> APT-YYYYMMDD-5001, APT-YYYYMMDD-5002, ...
 *   report_id_sequence            START 1    -> RPT-YYYYMMDD-0001, RPT-YYYYMMDD-0002, ...
 *   virtual_consultation_id_seq   START 1    -> VC-YYYYMMDD-0001, VC-YYYYMMDD-0002, ...
 *   emergency_alert_id_sequence   START 1    -> ALR-YYYYMMDD-0001, ALR-YYYYMMDD-0002, ...
 *   staff_id_sequence             START 1    -> STF-YYYYMMDD-0001, STF-YYYYMMDD-0002, ...
 *
 * The PREFIX makes the IDs unique across types (VC-... can never collide
 * with PT-..., APT-... or RPT-...), and each type draws from its OWN
 * sequence, so different ID types created on the same date never share a
 * suffix.
 *
 * Because the prefixes (and their ranges) can never overlap, a patient, an
 * appointment, a report and a consultation created on the same date NEVER
 * share a suffix.
 *
 * Rules honoured here:
 *   - Never SELECT COUNT(*): COUNT(*) races under concurrency.
 *   - Never Math.random(): IDs must be deterministic and gap-free-ish.
 *   - The ID is always generated on the BACKEND, inside the same transaction
 *     as the insert (see src/lib/sequentialId.ts).
 *   - Tables that do not exist yet are skipped gracefully, so a lazy table
 *     (uploaded_report) can never break patient/appointment ID generation.
 *   - Existing records are never touched: before a sequence is first used we
 *     inspect the IDs already stored for TODAY and fast-forward the sequence
 *     past them, so a new ID can never duplicate an existing one. The
 *     fast-forward is monotonic (never rewinds a sequence that is already
 *     ahead), so re-running the bootstrap is always safe.
 */

export type IdPrefix = "PT" | "APT" | "ALR" | "STF";

export type IdSequenceConfig = {
  /** PostgreSQL sequence name (global, independent per ID type). */
  sequence: string;
  /** Table holding the human-readable ID column. */
  table: "patient" | "appointment" | "emergency_alert" | "users";
  /** Human-readable ID column in that table. */
  idColumn: "patient_id" | "appointment_id" | "alert_id" | "staff_id";
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
  // Emergency alerts: ALR-YYYYMMDD-0001. Its own prefix AND its own
  // sequence, so an alert ID never reuses a patient or appointment ID.
  ALR: {
    sequence: "emergency_alert_id_sequence",
    table: "emergency_alert",
    idColumn: "alert_id",
    start: 1,
  },
  // Staff members: STF-YYYYMMDD-0001. Its own prefix AND its own sequence,
  // so a staff ID never reuses a patient, appointment or alert suffix. Backed
  // by the existing users table (staff_id column) after the staff-members
  // consolidation migration.
  STF: {
    sequence: "staff_id_sequence",
    table: "users",
    idColumn: "staff_id",
    start: 1,
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
 * Creates every configured sequence (PT / APT / RPT) if missing and advances
 * it past any ID that already exists for `dateStamp`. MUST run inside the caller's transaction
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

  // One CREATE per configured ID type (PT / APT / RPT / VC / ALR / STF) — a new prefix can
  // never reach the fast-forward query below without its sequence existing.
  for (const prefix of Object.keys(ID_SEQUENCE_CONFIG) as IdPrefix[]) {
    const cfg = ID_SEQUENCE_CONFIG[prefix];
    await client.query(
      `CREATE SEQUENCE IF NOT EXISTS ${cfg.sequence} START ${cfg.start}`
    );
  }

  for (const prefix of Object.keys(ID_SEQUENCE_CONFIG) as IdPrefix[]) {
    const cfg = ID_SEQUENCE_CONFIG[prefix];
    const like = `${prefix}-${dateStamp}-%`;

    // The table backing this ID type may not exist yet (uploaded_report is
    // created lazily by its own module, exactly like `service`). A missing
    // table means there are no IDs to skip past, so ONLY the fast-forward
    // query is skipped — the sequence above is still created. This keeps
    // patient/appointment inserts working long before the reports module has
    // ever run in this database.
    const present = await client.query<{ ok: boolean | null }>(
      "SELECT to_regclass($1) IS NOT NULL AS ok",
      [cfg.table]
    );
    if (!present.rows[0]?.ok) continue;

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
