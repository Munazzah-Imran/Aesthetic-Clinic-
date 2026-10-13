import fs from "node:fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) {
  console.error("no DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });

const q = async (sql) => (await pool.query(sql)).rows;

try {
  const tables = await q(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  console.log("TABLES:", tables.map((t) => t.table_name).join(", "));

  for (const col of ["users", "staff_permissions", "business"]) {
    const cols = await q(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [col]
    ).catch(() => []);
    if (!cols.length) { console.log(`\n${col}: DOES NOT EXIST`); continue; }
    console.log(`\n${col} columns:`);
    for (const c of cols) console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable === "NO" ? "NOT NULL" : ""} ${c.column_default ?? ""}`);
  }

  // FKs pointing at the candidate obsolete tables
  const fks = await q(`
    SELECT tc.table_name AS src, kcu.column_name, ccu.table_name AS tgt, tc.constraint_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
     ORDER BY tc.table_name
  `);
  console.log("\nALL FOREIGN KEYS:");
  for (const f of fks) console.log(`  ${f.src}.${f.column_name} -> ${f.tgt} (${f.delete_rule})`);

  // Views that might depend on obsolete tables
  const views = await q(`SELECT table_name FROM information_schema.views WHERE table_schema='public'`);
  console.log("\nVIEWS:", views.map((v) => v.table_name).join(", ") || "(none)");

  // row counts for candidate tables
  for (const t of tables.map((x) => x.table_name)) {
    if (/staff|report|consultation/i.test(t)) {
      const r = await q(`SELECT count(*)::int AS n FROM "${t}"`).catch((e) => [{ n: "ERR: " + e.message }]);
      console.log(`rows ${t}: ${r[0].n}`);
    }
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
