/**
 * One-time migration: repair per-doctor profile linking.
 *
 * Problem:
 *   1. The legacy `UNIQUE (business_id)` on doctor_profiles (from the
 *      single-doctor era) makes the per-doctor backfill in
 *      migrate-doctor-schedule.mjs silently no-op (ON CONFLICT DO NOTHING)
 *      and makes PUT /api/doctors/[id]/profile fail for any business that
 *      still has a legacy row — so no profile row is ever linked to a doctor.
 *   2. Legacy rows keep `doctor_id = NULL`, while GET /api/doctors/[id]/profile
 *      looks up `WHERE doctor_id = $1` — saved data becomes invisible.
 *
 * Fix (idempotent, no data deleted):
 *   1. DROP the stale UNIQUE (business_id) constraint. The intended
 *      uniqueness is the existing partial unique index on doctor_id
 *      (doctor_profiles_doctor_id_key), which the upsert already targets.
 *   2. Link every orphaned row (doctor_id IS NULL) to its doctor by matching
 *      business_id + full_name (doctor has UNIQUE (business_id, full_name),
 *      so the match is unambiguous). All other columns stay untouched.
 *
 * Run with:  node --experimental-strip-types --env-file=.env scripts/migrate-doctor-profile-link.mjs
 */
import fs from "fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 1. Drop the legacy one-profile-per-business constraint (multi-doctor
  //    profiles are keyed by doctor_id, not business_id).
  await client.query("ALTER TABLE doctor_profiles DROP CONSTRAINT IF EXISTS doctor_profiles_business_id_key");

  // 2. Link orphaned legacy rows to their doctor (business + name match).
  const linked = await client.query(`
    UPDATE doctor_profiles dp
       SET doctor_id = d.id
      FROM doctor d
     WHERE dp.doctor_id IS NULL
       AND d.business_id = dp.business_id
       AND lower(d.full_name) = lower(dp.full_name)
    RETURNING dp.id, dp.doctor_id, dp.full_name
  `);

  await client.query("COMMIT");

  // Verify final state.
  const orphans = await client.query(
    "SELECT count(*)::int AS n FROM doctor_profiles WHERE doctor_id IS NULL"
  );
  const indexes = await client.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'doctor_profiles' ORDER BY indexname"
  );

  console.log(`Linked ${linked.rowCount} orphaned profile row(s):`);
  for (const row of linked.rows) {
    console.log(`  - "${row.full_name}" -> doctor_id=${row.doctor_id}`);
  }
  console.log(`Rows still unlinked (no matching doctor): ${orphans.rows[0].n}`);
  console.log("Indexes:", indexes.rows.map((r) => r.indexname).join(", "));
  console.log("Migration complete.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
