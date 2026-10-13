import fs from "node:fs";
import { Pool } from "pg";

const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });
const q = async (sql) => (await pool.query(sql)).rows;

try {
  // 1) staff_members rows whose linked users row lacks consolidated fields
  const gaps = await q(`
    SELECT sm.staff_id AS sm_staff_id, sm.designation AS sm_desig, sm.account_status AS sm_status,
           sm.must_change_password AS sm_mcp, sm.deleted_at IS NOT NULL AS sm_deleted,
           u.id, u.staff_id AS u_staff_id, u.designation AS u_desig,
           u.account_status AS u_status, u.must_change_password AS u_mcp,
           u.deleted_at IS NOT NULL AS u_deleted, u.role, u.staff_uuid
      FROM staff_members sm
      JOIN users u ON u.id = sm.user_id
     WHERE u.staff_id IS DISTINCT FROM sm.staff_id
        OR u.designation IS DISTINCT FROM sm.designation
        OR u.account_status IS DISTINCT FROM sm.account_status
        OR u.must_change_password IS DISTINCT FROM sm.must_change_password
        OR (u.deleted_at IS NULL) IS DISTINCT FROM (sm.deleted_at IS NULL)
        OR u.role IS DISTINCT FROM sm.role`);
  console.log("divergent staff_members<->users rows:", gaps.length);
  for (const g of gaps.slice(0, 30)) console.log(JSON.stringify(g));

  // 2) users missing staff_id / staff_uuid among role=staff
  const miss = await q(`
    SELECT count(*)::int n FROM users WHERE role='staff' AND (staff_id IS NULL OR staff_uuid IS NULL)`);
  console.log("staff users missing staff_id/staff_uuid:", miss[0].n);

  // 3) duplicate staff_id between the two tables (users.staff_id unique)
  const dup = await q(`
    SELECT sm.staff_id FROM staff_members sm
      JOIN users u ON u.staff_id = sm.staff_id AND u.id <> sm.user_id`);
  console.log("staff_id collisions across tables:", dup.length);

  // 4) created_by info: is anything else in staff_members not in users?
  const colsOnly = await q(`
    SELECT DISTINCT column_name FROM information_schema.columns
     WHERE table_name='staff_members' AND column_name NOT IN
       ('id','staff_id','user_id','business_id','designation','role','account_status',
        'must_change_password','created_by','created_at','updated_at','deleted_at')`);
  console.log("unexpected staff_members columns:", JSON.stringify(colsOnly));

  // 5) sequences that exist
  const seqs = await q(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' ORDER BY 1`);
  console.log("sequences:", seqs.map((s) => s.sequence_name).join(", "));

  // 6) permission rows referencing staff_members still? (column drop check)
  const sp = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='staff_permissions' AND column_name='staff_member_id'`);
  console.log("staff_member_id column still present:", sp.length === 1);
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
