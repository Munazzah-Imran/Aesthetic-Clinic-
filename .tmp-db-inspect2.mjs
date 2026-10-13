import fs from "node:fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });
const q = async (sql) => (await pool.query(sql)).rows;

try {
  for (const t of ["users", "staff_permissions", "staff_members", "uploaded_report", "virtual_consultation"]) {
    const cols = await q(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${t}'
        ORDER BY ordinal_position`
    );
    if (!cols.length) { console.log(`\n== ${t}: DOES NOT EXIST ==`); continue; }
    console.log(`\n== ${t} ==`);
    for (const c of cols)
      console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable === "NO" ? "NOT NULL" : "null"} ${c.column_default ?? ""}`);
  }

  const idx = await q(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND tablename IN ('users','staff_permissions','staff_members')`);
  console.log("\n== INDEXES ==");
  for (const i of idx) console.log(`  ${i.indexname}: ${i.indexdef}`);

  const cons = await q(`
    SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
        AND conrelid::regclass::text IN ('users','staff_permissions','staff_members')`);
  console.log("\n== CONSTRAINTS ==");
  for (const c of cons) console.log(`  ${c.tbl}: ${c.conname} ${c.def}`);

  // staff_permissions rows: do they reference valid users?
  const sp = await q(`SELECT count(*)::int n FROM staff_permissions`);
  const spOrphan = await q(`
    SELECT count(*)::int n FROM staff_permissions sp
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sp.user_id)`);
  console.log(`\nstaff_permissions rows: ${sp[0].n}, orphaned(user missing): ${spOrphan[0].n}`);

  // role/status distribution in users
  const roles = await q(`
    SELECT COALESCE(role::text,'(no role col)') role, count(*)::int n FROM users GROUP BY 1`).catch(async () => {
      return [{ role: "(role column missing)", n: 0 }];
    });
  console.log("users role distribution:", JSON.stringify(roles));

  const sm = await q(`
    SELECT count(*)::int n FROM staff_members sm
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sm.user_id)`);
  const smJoin = await q(`
    SELECT count(*)::int n FROM staff_members sm JOIN users u ON u.id = sm.user_id`);
  console.log(`staff_members rows joined to users: ${smJoin[0].n}, orphaned: ${sm[0].n}`);

  const tables = ["users", "staff_members", "uploaded_report", "virtual_consultation", "staff_permissions"];
  for (const t of tables) {
    const r = await q(`SELECT count(*)::int n FROM ${t}`).catch(() => [{ n: -1 }]);
    console.log(`rows ${t}: ${r[0].n}`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
