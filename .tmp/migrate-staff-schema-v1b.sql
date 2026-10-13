-- ============================================================================
-- Migration v1b — add the soft-delete marker and stable UUID handle to users
-- so the staff API can keep using UUID handles (StaffRecord.id) while
-- staff_permissions is keyed by users.id (integer), per the refactor spec.
--
-- Idempotent. Backfills from staff_members; safe to re-run.
-- ============================================================================

BEGIN;

-- Stable UUID handle for the staff API (staff record id), mirrors the old
-- staff_members.id. Reused from the existing staff_members row so existing
-- URLs / tests / bookmarks keep working. Nullable: only staff have one;
-- owners / non-staff users do not.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS staff_uuid UUID UNIQUE;

-- Soft-delete marker (mirrors staff_members.deleted_at). If hard-deletion of a
-- staff_members row ever happened (CASCADE), this is the flag we keep on users
-- so "deleted staff" stays distinguishable from "staff with zero permissions".
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 1. Backfill staff_uuid + the staff-account columns that were left at their
--    defaults for users whose staff_members row was DELETED (deleted_at IS NOT
--    NULL). The v1 backfill deliberately skipped those (deleted_at IS NULL), so
--    we now mark them deleted + inactive on users, matching the old state.
UPDATE users u
SET staff_uuid = sm.id,
    deleted_at = sm.deleted_at,
    account_status = sm.account_status          -- 'inactive' on deleted rows
FROM staff_members sm
WHERE sm.user_id = u.id
  AND sm.deleted_at IS NOT NULL
  AND u.staff_uuid IS NULL;                    -- idempotent

-- 2. Backfill staff_uuid for the (non-deleted) staff_members rows that were
--    already handled by v1 for the other columns, but whose staff_uuid is still
--    null (e.g. a re-run scenario). Use sm.id as the stable handle.
UPDATE users u
SET staff_uuid = sm.id
FROM staff_members sm
WHERE sm.user_id = u.id
  AND sm.deleted_at IS NULL
  AND u.staff_uuid IS NULL;

-- 3. Owners: must_change_password must be FALSE — owners bypass the
--    first-login password-change gate entirely (they set their password at
--    signup). v1 set role='admin' for owners but left must_change_password at
--    the column default (TRUE), which would wrongly gate owners without a
--    password change. Fix that here.
UPDATE users u
SET must_change_password = FALSE
WHERE u.role = 'admin'
  AND u.must_change_password = TRUE;

COMMIT;
