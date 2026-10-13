// ============================================================================
// Migration v1b — add the soft-delete marker (deleted_at) and stable UUID
// handle (staff_uuid) to users, backfill from staff_members, and set owners'
// must_change_password = FALSE (owners bypass the first-login gate).
//
// Idempotent (safe to re-run). Keeps staff_members intact.
//
// Run: node .tmp/migrate-staff-schema-v1b.mjs
// ============================================================================
import fs from 'fs'
import pg from 'pg'

const envRaw = fs.readFileSync('.env').toString()
const dbUrl = envRaw.match(/DATABASE_URL=(.*)/)?.[1] ?? process.env.DATABASE_URL
if (!dbUrl) throw new Error('DATABASE_URL is not set')

const pool = new pg.Pool({ connectionString: dbUrl, max: 2, idleTimeoutMillis: 8000, connectionTimeoutMillis: 12000 })
const log = (...a) => console.log('[v1b]', ...a)

const exec = async (sql, params = []) => {
  const start = Date.now()
  const res = await pool.query(sql, params)
  log(`OK  ${sql.replace(/\s+/g, ' ').slice(0, 95)}  (${Date.now() - start}ms)`)
  return res
}

const main = async () => {
  try {
    log('starting migration v1b')

    await exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_uuid UUID UNIQUE`)
    await exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)

    // Backfill staff_uuid + deleted_at + account_status for users whose
    // staff_members row was DELETED (deleted_at IS NOT NULL). v1 skipped these,
    // so without this they would wrongly appear as active, non-deleted staff.
    const deletedBackfill = await exec(
      `UPDATE users u SET staff_uuid = sm.id, deleted_at = sm.deleted_at,
        account_status = sm.account_status
      FROM staff_members sm
      WHERE sm.user_id = u.id
        AND sm.deleted_at IS NOT NULL
        AND u.staff_uuid IS NULL`
    )
    log(`backfilled deleted staff (staff_uuid + deleted_at + account_status): ${deletedBackfill.rowCount ?? 0} rows`)

    // Backfill staff_uuid for non-deleted staff_members rows that still have a
    // null staff_uuid (e.g. re-run scenario). sm.id is the stable handle.
    const activeBackfill = await exec(
      `UPDATE users u SET staff_uuid = sm.id
      FROM staff_members sm
      WHERE sm.user_id = u.id
        AND sm.deleted_at IS NULL
        AND u.staff_uuid IS NULL`
    )
    log(`backfilled staff_uuid for active staff: ${activeBackfill.rowCount ?? 0} rows`)

    // Owners: must_change_password must be FALSE (owners bypass the first-login
    // gate entirely — they set their password at signup).
    const ownerPwd = await exec(
      `UPDATE users u SET must_change_password = FALSE
      WHERE u.role = 'admin' AND u.must_change_password = TRUE`
    )
    log(`owners must_change_password set to FALSE: ${ownerPwd.rowCount ?? 0} rows`)

    // Verify
    const problemRows = await pool.query(
      `SELECT count(*)::int AS n FROM users u
        LEFT JOIN staff_members sm ON sm.user_id = u.id
        WHERE sm.deleted_at IS NOT NULL
          AND (u.deleted_at IS NULL OR u.account_status <> sm.account_status
               OR u.staff_uuid IS NULL)`
    )
    if ((problemRows.rows[0]?.n ?? 0) > 0) {
      throw new Error(`${problemRows.rows[0].n} users still out of sync with their deleted staff_members row after v1b`)
    }
    log('verified: every deleted staff_members row now has matching users.deleted_at + account_status + staff_uuid')

    log('migration v1b complete; staff_members still present')
  } catch (e) {
    log('ERROR', String(e))
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
