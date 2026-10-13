/**
 * Idempotent migration: Staff Inbox (Step 2 — schema only).
 *
 * Adds ONLY new objects on top of the EXISTING schema — no existing table,
 * column, or row is modified, dropped, or renamed, and no staff accounts or
 * sample messages are inserted:
 *
 *   staff_messages            — one row per internal message sent by a staff
 *                               member (users row) to one or more recipients.
 *   staff_message_recipients  — one row per (message, recipient) pair carrying
 *                               that recipient's read/star/archive state.
 *
 * Schema facts this migration is built on (inspected, not assumed):
 *   - users.id is INTEGER (serial), not UUID -> sender/recipient FKs are INTEGER.
 *   - users.business_id -> business(id) ON DELETE CASCADE; there is NO role
 *     column: every users row is a staff member of its business.
 *   - business.id is UUID (gen_random_uuid()).
 *   - Security model: RLS is disabled on every existing table; all modules
 *     enforce tenancy at the application layer (authenticated JWT ->
 *     business_id -> WHERE business_id = $1). These tables follow the SAME
 *     model — enabling RLS only here would be inconsistent and is not part
 *     of this step.
 *
 * Same-business integrity: sender_id and recipient_id reference users, and
 * the API layer (Step 3) must verify each user's business_id matches the
 * message's business_id before any read/write — exactly how appointments,
 * reports, consultations and alerts already scope their queries.
 *
 * Safe to run repeatedly (CREATE TABLE/INDEX IF NOT EXISTS): running it
 * again creates no duplicate objects. Run with:
 *   npm run db:migrate:staff-inbox
 */
import pool from "../src/lib/db.ts";

async function main() {
  console.log("Migrating: staff inbox schema...");

  // ---- staff_messages: the message itself (sender, content, classification) ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_messages (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
      sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject     VARCHAR(255) NOT NULL,
      body        TEXT NOT NULL,
      category    VARCHAR(30) NOT NULL DEFAULT 'general'
                  CHECK (category IN ('general', 'announcement', 'appointment', 'urgent')),
      priority    VARCHAR(20) NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('normal', 'important', 'urgent')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  = staff_messages table ready");

  // Business listing (newest first) + per-sender queries (Sent folder).
  await pool.query(
    "CREATE INDEX IF NOT EXISTS staff_messages_business_idx ON staff_messages (business_id, created_at DESC)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS staff_messages_sender_idx ON staff_messages (sender_id)"
  );

  // ---- staff_message_recipients: per-recipient delivery + read/star/archive ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_message_recipients (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id  UUID NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_read     BOOLEAN NOT NULL DEFAULT FALSE,
      read_at     TIMESTAMPTZ,
      is_starred  BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (message_id, recipient_id)
    )
  `);
  console.log("  = staff_message_recipients table ready");

  // Inbox lookups by recipient (the UNIQUE constraint below also serves
  // message_id lookups — its leading column is message_id, so a separate
  // message_id index would be redundant).
  await pool.query(
    "CREATE INDEX IF NOT EXISTS staff_message_recipients_recipient_idx ON staff_message_recipients (recipient_id)"
  );
  // Unread filtering (Unread tab / unread badge) and archive filtering
  // (Archived tab) — partial indexes keep them small and targeted.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS staff_message_recipients_unread_idx
      ON staff_message_recipients (recipient_id, created_at DESC)
      WHERE is_read = FALSE
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS staff_message_recipients_archived_idx
      ON staff_message_recipients (recipient_id, created_at DESC)
      WHERE is_archived = TRUE
  `);

  console.log("Migration complete.");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
    return pool.end();
  });
