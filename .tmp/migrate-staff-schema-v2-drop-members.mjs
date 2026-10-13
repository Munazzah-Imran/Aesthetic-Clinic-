// ============================================================================
// Migration v2 — drop staff_members (now obsolete) AFTER the application code
// has been migrated to query users + staff_permissions(user_id) and verified.
//
// Pre-condition checks (hard fail if the app still relies on the table in a way
// we haven't migrated): every staff_permissions row must already have a user_id,
// staff_messages / staff_message_recipients must NOT reference staff_members
// (they reference users.id, which stays), and no staff_permissions row may still
// reference a deleted staff_members row.
//
// Run: node .tmp/migrate-staff-schema-v2-drop-members.mjs
// ============================================================================
import fs from 'fs'
import pg from 'pg'

const envRaw = fs.readFileSync('.env').toString()
const dbUrl = envRaw.match(/DATABASE_URL=(.*)/)?.[1] ?? process.env.DATABASE_URL
if (!dbUrl) throw new Error('DATABASE_URL is not set')

const pool = new pg.Pool({ connectionString: dbUrl, max: 2, idleTimeoutMillis: 8000, connectionTimeoutMillis: 12000 })

const log = (...a) => console.log('[v2]', ...a)

const main = async () => {
  try {
    log('pre-condition checks before dropping staff_members')

    // 1. staff_permissions must be fully migrated onto user_id.
    const unmapped = await pool.query(
      `SELECT count(*)::int AS n FROM staff_permissions
        WHERE user_id IS NULL`
    )
    if ((unmapped.rows[0]?.n ?? 0) > 0) {
      throw new Error(`cannot drop staff_members: ${unmapped.rows[0].n} staff_permissions rows still lack user_id`)
    }
    log('staff_permissions fully migrated onto user_id')

    // 2. No staff_permissions row references a deleted staff_members row
    //    (all populated rows now point at users via user_id; this is a safety net).
    const orphaned = await pool.query(
      `SELECT count(*)::int AS n FROM staff_permissions sp
        WHERE NOT EXISTS (
          SELECT 1 FROM users u WHERE u.id = sp.user_id
        )`
    )
    if ((orphaned.rows[0]?.n ?? 0) > 0) {
      throw new Error(`cannot drop staff_members: ${orphaned.rows[0].n} staff_permissions rows have no matching users row`)
    }
    log('no orphaned staff_permissions rows')

    // 3. staff_messages.sender_id and staff_message_recipients.recipient_id must
    //    reference users.id (they already do) — confirm the FK target is users.
    const senderFk = await pool.query(
      `SELECT ccu.table_name, ccu.column_name
         FROM information_schema.constraint_column_usage ccu
         JOIN information_schema.table_constraints tc
           ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = 'staff_messages'
          AND ccu.column_name = 'sender_id'`
    )
    const recipFk = await pool.query(
      `SELECT ccu.table_name, ccu.column_name
         FROM information_schema.constraint_column_usage ccu
         JOIN information_schema.table_constraints tc
           ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = 'staff_message_recipients'
          AND ccu.column_name = 'recipient_id'`
    )
    const senderTarget = senderFk.rows[0]?.table_name
    const recipTarget = recipFk.rows[0]?.table_name
    if (senderTarget !== 'users' || recipTarget !== 'users') {
      throw new Error(
        `staff_messages.sender_id -> ${senderTarget} and staff_message_recipients.recipient_id -> ${recipTarget}; expected both -> users`
      )
    }
    log('staff_messages + staff_message_recipients already reference users.id (safe to drop staff_members)')

    // 4. Confirm staff_members has no unexpected inbound FK from an app table we
    //    forgot to migrate.
    const inbound = await pool.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND kcu.referenced_table_name = 'staff_members'
        ORDER BY tc.table_name, kcu.ordinal_position`
    )
    if (inbound.rows.length > 0) {
      throw new Error(
        `staff_members still has inbound FKs from: ${inbound.rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ')}`
      )
    }
    log('no remaining inbound FKs to staff_members')

    // ---------- Drop staff_members ----------
    // Drop the FK columns on staff_permissions that now have replacements (they
    // keep user_id + business_id). Drop old staff_member_id column + FK first.
    await pool.query(
      `ALTER TABLE staff_permissions DROP CONSTRAINT IF EXISTS staff_permissions_staff_member_id_fkey`
    )
    await pool.query(`ALTER TABLE staff_permissions DROP COLUMN IF EXISTS staff_member_id`)
    log('staff_permissions: dropped old staff_member_id + FK')

    // Drop the FK from staff_members -> users(business_id is on users; staff_members
    // has business_id and user_id) — these live only on staff_members, so dropping
    // the table removes them. But there may be a named FK we should drop explicitly
    // if anything else references staff_members. We already checked inbound above.
    await pool.query(`DROP TABLE IF EXISTS staff_members CASCADE`)
    log('dropped staff_members (CASCADE removes no app-critical FKs — confirmed above)')

    // Clean up stale sequences/indexes that only staff_members used (optional).
    await pool.query(`DROP INDEX IF EXISTS staff_members_business_idx`)
    await pool.query(`DROP INDEX IF EXISTS staff_members_user_idx`)
    log('removed staff_members-only indexes')

    log('migration v2 complete: staff_members removed, app now uses users + staff_permissions(user_id, business_id)')
  } catch (e) {
    log('ERROR', String(e))
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
