import fs from "node:fs";
import { Pool } from "pg";

const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

// ---------- 1. BACKUP the rows that are about to be dropped ----------
const backup = {
  takenAt: new Date().toISOString(),
  staff_members: await q("SELECT * FROM staff_members"),
  staff_permissions_old: await q("SELECT * FROM staff_permissions"),
  uploaded_report: await q("SELECT * FROM uploaded_report"),
  virtual_consultation: await q("SELECT * FROM virtual_consultation"),
};
fs.writeFileSync(".tmp-staff-drop-backup.json", JSON.stringify(backup, null, 2));
console.log(
  `backup written: staff_members=${backup.staff_members.length} staff_permissions=${backup.staff_permissions_old.length} uploaded_report=${backup.uploaded_report.length} virtual_consultation=${backup.virtual_consultation.length}`
);

// ---------- 2. TRANSACTION: backfill users + drop legacy permission column ----------
const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 2a. Preserve legacy data that exists ONLY in staff_members before it goes away.
  const bf1 = await client.query(`
    UPDATE users u
       SET staff_id = sm.staff_id
      FROM staff_members sm
     WHERE sm.user_id = u.id
       AND u.staff_id IS NULL`);
  const bf2 = await client.query(`
    UPDATE users u
       SET designation = sm.designation
      FROM staff_members sm
     WHERE sm.user_id = u.id
       AND u.designation IS NULL`);
  console.log(`backfilled users.staff_id=${bf1.rowCount}, users.designation=${bf2.rowCount}`);

  // 2b. Legacy shape: staff_permissions.staff_member_id NOT NULL -> staff_members.
  await client.query(
    "ALTER TABLE staff_permissions DROP CONSTRAINT IF EXISTS staff_permissions_staff_member_id_fkey"
  );
  await client.query(
    "ALTER TABLE staff_permissions DROP COLUMN IF EXISTS staff_member_id"
  );

  // 2c. Sanity inside the transaction: every permission row maps to a real user.
  const orphan = await client.query(`
    SELECT count(*)::int n FROM staff_permissions sp
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sp.user_id)`);
  if (orphan.rows[0].n !== 0) throw new Error(`orphaned staff_permissions rows: ${orphan.rows[0].n}`);

  await client.query("COMMIT");
  console.log("transaction committed (backfill + column drop)");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("TRANSACTION ROLLED BACK:", e.message);
  process.exit(1);
} finally {
  client.release();
}

// ---------- 3. DROP obsolete tables (no remaining dependents) ----------
for (const t of ["staff_members", "uploaded_report", "virtual_consultation"]) {
  await pool.query(`DROP TABLE IF EXISTS ${t}`);
  console.log(`dropped table ${t}`);
}

// ---------- 4. DROP the now-unused ID sequences (config entries removed in code) ----------
for (const s of ["report_id_sequence", "virtual_consultation_id_sequence"]) {
  await pool.query(`DROP SEQUENCE IF EXISTS ${s}`);
  console.log(`dropped sequence ${s}`);
}

// ---------- 5. VERIFY final state ----------
const tables = await q(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
const gone = ["staff_members", "uploaded_report", "virtual_consultation"].filter((t) =>
  tables.some((r) => r.table_name === t)
);
const keep = ["users", "staff_permissions", "business"].filter(
  (t) => !tables.some((r) => r.table_name === t)
);
const spCols = await q(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_permissions' ORDER BY ordinal_position`);
const counts = {
  users: (await q("SELECT count(*)::int n FROM users"))[0].n,
  staff_permissions: (await q("SELECT count(*)::int n FROM staff_permissions"))[0].n,
  business: (await q("SELECT count(*)::int n FROM business"))[0].n,
};
const staffWithId = (await q(
  "SELECT count(*)::int n FROM users WHERE role='staff' AND staff_id IS NOT NULL"
))[0].n;

console.log("\n== FINAL STATE ==");
console.log("tables:", tables.map((t) => t.table_name).join(", "));
console.log("obsolete tables still present:", gone.length ? gone : "NONE");
console.log("required tables missing:", keep.length ? keep : "NONE");
console.log("staff_permissions columns:", spCols.map((c) => c.column_name).join(", "));
console.log("counts:", JSON.stringify(counts), "staff with staff_id:", staffWithId);

if (gone.length || keep.length) process.exitCode = 1;
await pool.end();
