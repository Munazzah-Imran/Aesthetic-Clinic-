import pool from "@/lib/db";
import {
  ID_SEQUENCE_CONFIG,
  ensureIdSequences,
  serverDateStamp,
  type IdPrefix,
} from "@/lib/idSequences";

/**
 * Concurrency-safe sequential business IDs (server-only).
 *
 * Format: PREFIX-YYYYMMDD-NNNN
 *   Patient:     PT-20260923-0001, PT-20260923-0002, ...  (patient_id_sequence,      START 1)
 *   Appointment: APT-20260923-5001, APT-20260923-5002, ... (appointment_id_sequence,  START 5001)
 *
 * The numeric parts come from TWO completely independent PostgreSQL
 * sequences, so a patient and an appointment created on the same date can
 * NEVER share the same suffix (0001.. vs 5001.. never overlap).
 *
 * Why not SELECT COUNT(*)? COUNT(*) can hand the same number to two
 * concurrent requests -> duplicate IDs (exactly the failure mode this
 * helper exists to prevent).
 * Why not Math.random()? Randomness is not a sequence; collisions are
 * possible and numbering would be untraceable.
 *
 * Mechanism:
 *   1. BEGIN.
 *   2. First use per process: ensureIdSequences() creates the sequences if
 *      missing and fast-forwards them past any ID that already exists for
 *      today — existing records are inspected, never changed or deleted.
 *   3. nextval(<sequence>) — atomic in PostgreSQL, safe under concurrency.
 *   4. INSERT with the formatted code inside the SAME transaction, then COMMIT.
 *
 * The UNIQUE (business_id, <id column>) constraint is the final guard: even
 * if something unexpected happened, a duplicate insert would error and the
 * whole transaction rolls back — a partial record can never be created.
 *
 * The date part always uses the SERVER date (never the browser's), and the
 * sequence is global per ID type: numbering keeps advancing across days
 * (it never rewinds, so it can never repeat a suffix on the same date).
 */
let sequencesReady = false;

/**
 * Generates the next ID for `prefix` from its PostgreSQL sequence and runs
 * `insert` with it, all inside ONE transaction. `insert` must use the SAME
 * client (so it joins the transaction). Throws on failure; the transaction
 * (including the row, though the sequence value itself is not rolled back)
 * rolls back.
 */
export async function withSequentialId<T>(
  prefix: IdPrefix,
  insert: (code: string, client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const cfg = ID_SEQUENCE_CONFIG[prefix];
  const dateStamp = serverDateStamp();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (!sequencesReady) {
      await ensureIdSequences(client, dateStamp);
      sequencesReady = true;
    }

    const seq = await client.query<{ next: string }>(
      "SELECT nextval($1::regclass) AS next",
      [cfg.sequence]
    );
    const n = Number(seq.rows[0]?.next);
    if (!Number.isFinite(n) || n < cfg.start) {
      throw new Error(`Unable to draw the next value from ${cfg.sequence}.`);
    }
    // padStart keeps the 4-digit look (0001 / 5001) and simply grows to
    // 5+ digits far in the future — uniqueness is guaranteed by the
    // sequence itself, never by the padding.
    const code = `${prefix}-${dateStamp}-${String(n).padStart(4, "0")}`;

    const result = await insert(code, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already gone — nothing to roll back
    }
    throw err;
  } finally {
    client.release();
  }
}
