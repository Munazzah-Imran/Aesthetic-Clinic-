// ============================================================================
// Migration v1 — consolidate staff auth onto the existing users table and
// redesign staff_permissions to key off users.id + business.id.
//
// Idempotent (safe to re-run). Keeps staff_members intact until the
// application code is fully migrated and verified.
//
// Run: node .tmp/migrate-staff-schema-v1.mjs
// ============================================================================
import fs from 'fs'
import pg from 'pg'

const envRaw = fs.readFileSync('.env').toString()
const dbUrl = envRaw.match(/DATABASE_URL=(.*)/)?.[1] ?? process.env.DATABASE_URL
if (!dbUrl) throw new Error('DATABASE_URL is not set')

const pool = new pg.Pool({ connectionString: dbUrl, max: 2, idleTimeoutMillis: 8000, connectionTimeoutMillis: 12000 })

const log = (...a) => console.log('[v1]', ...a)

const exec = async (sql, params = []) => {
  const start = Date.now()
  const res = await pool.query(sql, params)
  log(`OK  ${sql.replace(/\s+/g, ' ').slice(0, 90)}  (${Date.now() - start}ms)`)
  return res
}

const main = async () => {
  try {
    log('starting migration v1')

    // ---------- 1. Add staff-account columns to users ----------
    await exec(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'staff'
        CHECK (role IN ('admin', 'staff'))`)
    await exec(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS designation VARCHAR(100)`)
    await exec(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'inactive'))`)
    await exec(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE`)
    await exec(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50) UNIQUE`)

    // Backfill staff-account attributes from staff_members.
    const backfill = await exec(
      `UPDATE users u SET role='staff', designation=sm.designation,
        account_status=sm.account_status, must_change_password=sm.must_change_password,
        staff_id=sm.staff_id
      FROM staff_members sm
      WHERE sm.user_id = u.id AND sm.deleted_at IS NULL`
    )
    log(`backfilled users from staff_members: ${backfill.rowCount ?? 0} rows`)

    // Mark business owners as role='admin' (earliest user per business).
    const ownerUpd = await exec(
      `UPDATE users u SET role='admin'
       WHERE u.business_id IS NOT NULL
         AND u.id = (
           SELECT earliest.id FROM (
             SELECT id FROM users
             WHERE business_id IS NOT NULL
             ORDER BY created_at ASC, id ASC
             LIMIT 1
           ) AS earliest
         )`
    )
    log(`owner-marked users: ${ownerUpd.rowCount ?? 0} rows`)

    // ---------- 2. Redesign staff_permissions ----------
    await exec(`ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS user_id INTEGER`)
    await exec(`ALTER TABLE staff_permissions ADD COLUMN IF NOT EXISTS business_id UUID`)

    // Populate from existing FK path. Skip rows whose staff_members row was deleted.
    const populate = await exec(
      `UPDATE staff_permissions sp SET user_id=sm.user_id, business_id=sm.business_id
       FROM staff_members sm
       WHERE sp.staff_member_id = sm.id AND sm.deleted_at IS NULL`
    )
    log(`staff_permissions mapped to user_id/business_id: ${populate.rowCount ?? 0} rows`)

    // Make user_id mandatory + add FK + unique guard.
    await exec(`ALTER TABLE staff_permissions ALTER COLUMN user_id SET NOT NULL`)
    await exec(
      `ALTER TABLE staff_permissions
        ADD CONSTRAINT staff_permissions_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        NOT VALID`
    )
    await exec(`ALTER TABLE staff_permissions VALIDATE CONSTRAINT staff_permissions_user_id_fkey`)
    await exec(
      `ALTER TABLE staff_permissions
        ADD CONSTRAINT staff_permissions_user_permission_key_key
          UNIQUE (user_id, permission_key)`
    )

    // Business isolation FK.
    await exec(`ALTER TABLE staff_permissions ALTER COLUMN business_id SET NOT NULL`)
    await exec(
      `ALTER TABLE staff_permissions
        ADD CONSTRAINT staff_permissions_business_id_fkey
          FOREIGN KEY (business_id) REFERENCES business(id) ON DELETE CASCADE
        NOT VALID`
    )
    await exec(`ALTER TABLE staff_permissions VALIDATE CONSTRAINT staff_permissions_business_id_fkey`)

    // ---------- 3. Verify ----------
    const badRows = await pool.query(
      `SELECT count(*)::int AS n FROM staff_permissions
        WHERE user_id IS NULL OR business_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM users WHERE id = staff_permissions.user_id
        )`
    )
    if ((badRows.rows[0]?.n ?? 0) > 0) {
      throw new Error(`staff_permissions still has ${badRows.rows[0].n} unmapped rows after v1`)
    }
    log('verified: every staff_permissions row now has a valid user_id + business_id')

    log('migration v1 complete; staff_members is still present and unchanged')
  } catch (e) {
    log('ERROR', String(e))
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
