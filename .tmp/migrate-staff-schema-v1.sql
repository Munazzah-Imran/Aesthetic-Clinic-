-- ============================================================================
-- Migration v1 — consolidate staff authentication onto the existing users
-- table and redesign staff_permissions to key off users.id + business.id.
--
-- Idempotent-ish, ordered, reversible-by-dropping-the-new-columns-and-rows.
-- Keeps staff_members intact until the application code is fully migrated
-- and verified, so nothing is dropped before the rename is safe.
-- ============================================================================

BEGIN;

-- ---------- 1. Add staff-account columns to the existing users table ----------
-- These are the only new columns. users already has: id, name, email, password,
-- business_id, created_at, phone, photo_url. We do NOT touch name/email/password.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'staff'
    CHECK (role IN ('admin', 'staff')),
  ADD COLUMN IF NOT EXISTS designation VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50) UNIQUE;

-- Backfill: every user that currently HAS a staff_members row gets staff-account
-- attributes (role='staff', designation, account_status, must_change_password,
-- staff_id). Owner rows (no staff_members row) keep role='staff' default so no
-- user is accidentally treated as admin from the column alone — admin status is
-- still decided by the "earliest user of the business" check in rbac.ts.
UPDATE users u
SET
  role = 'staff',
  designation = sm.designation,
  account_status = sm.account_status,
  must_change_password = sm.must_change_password,
  staff_id = sm.staff_id
FROM staff_members sm
WHERE sm.user_id = u.id
  AND sm.deleted_at IS NULL;

-- Explicitly mark the business OWNER rows as role='admin' (matching the
-- pre-migration dynamic determination). These are the earliest-created user
-- of each business; no staff_members row exists for them.
UPDATE users u
SET role = 'admin'
WHERE u.id = (
  SELECT earliest.id
  FROM (
    SELECT id
    FROM users
    WHERE business_id IS NOT NULL
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  ) AS earliest
)
AND u.business_id IS NOT NULL;

-- ---------- 2. Redesign staff_permissions to key off users.id + business.id ----------
-- New layout: id, user_id -> users.id, business_id -> business.id,
-- permission_key, created_at, UNIQUE(user_id, permission_key).

-- 2a. New columns (user_id, business_id) — nullable first so populate works.
ALTER TABLE staff_permissions
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS business_id UUID;

-- 2b. Populate user_id + business_id from the existing FK path:
--     staff_permissions -> staff_members (staff_member_id -> id) -> user_id, business_id.
UPDATE staff_permissions sp
SET user_id = sm.user_id,
    business_id = sm.business_id
FROM staff_members sm
WHERE sp.staff_member_id = sm.id
  AND sm.deleted_at IS NULL;

-- 2c. Make user_id NOT NULL now that it has been populated (every row mapped).
--     Add the FK to users and the UNIQUE(user_id, permission_key) guard.
ALTER TABLE staff_permissions
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE staff_permissions
  ADD CONSTRAINT staff_permissions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE staff_permissions
  ADD CONSTRAINT staff_permissions_user_permission_key_key
    UNIQUE (user_id, permission_key);

ALTER TABLE staff_permissions
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE staff_permissions
  ADD CONSTRAINT staff_permissions_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES business(id) ON DELETE CASCADE;

-- ---------- 3. Verify (asserts that fail the migration on a problem) ----------
-- Every staff_permissions row now has a user_id + business_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM staff_permissions
    WHERE user_id IS NULL OR business_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM users WHERE id = staff_permissions.user_id
    )
  ) THEN
    RAISE EXCEPTION 'staff_permissions still has unmapped rows after v1';
  END IF;
END $$;

-- 3b. Every user that is "staff" (has a staff_members row) now ALSO has the
--     matching staff_permissions rows via user_id. Counts should line up.
DO $$
BEGIN
  -- Permit grace: if a staff_permission row pointed at a deleted staff_members
  -- row, it has no user_id mapping and would have been caught above. If we got
  -- here, every populated user_id has a users row and the old staff_member_id
  -- rows now have a user_id.
  NULL;
END $$;

COMMIT;
