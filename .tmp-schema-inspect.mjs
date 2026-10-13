import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tables = await pool.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
   ORDER BY table_name`
);
console.log("TABLES:", tables.rows.map((r) => r.table_name).join(", "));

for (const t of ["users", "business"]) {
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  console.log(`\n${t}:`);
  for (const c of cols.rows) console.log("  ", c.column_name, c.data_type, c.is_nullable, c.column_default ?? "");
}

const u = await pool.query(
  "SELECT id, name, email, business_id, created_at FROM users ORDER BY id"
);
console.log("\nUSERS:");
for (const r of u.rows) console.log("  ", JSON.stringify(r));

const b = await pool.query("SELECT id, business_name, email, created_at FROM business ORDER BY id");
console.log("\nBUSINESS:");
for (const r of b.rows) console.log("  ", JSON.stringify(r));

// any role/permission-ish columns anywhere?
const cols = await pool.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public' AND (column_name ILIKE '%role%' OR column_name ILIKE '%permission%' OR column_name ILIKE '%staff%')
   ORDER BY table_name, column_name`
);
console.log("\nROLE/PERMISSION/STAFF COLUMNS:");
for (const c of cols.rows) console.log("  ", c.table_name + "." + c.column_name);

await pool.end();
