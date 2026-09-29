/**
 * Idempotent migration: profile + settings support.
 *
 * Adds ONLY the missing pieces on top of the EXISTING schema — no duplicate
 * tables, no data changes:
 *
 *   users.photo_url            — admin profile photo (data URL, like doctor_profiles)
 *   users.phone                — admin personal phone number
 *   business.logo_url          — business logo (data URL)
 *   business.contact_number    — business public contact number
 *   business.full_address      — business full address
 *   business.city              — business city
 *   business.city_code         — business city code
 *   business.google_maps_url   — business Google Maps URL
 *   business_settings          — ONE row per business: notifications,
 *                                appointment preferences, system preferences.
 *
 * Safe to run repeatedly: every statement checks before acting, exactly like
 * scripts/db-init.ts. Run with:  npm run db:migrate:profile-settings
 */
import pool from "../src/lib/db.ts";

async function addColumn(table, column, definition) {
  const exists = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  if (exists.rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  + ${table}.${column}`);
  } else {
    console.log(`  = ${table}.${column} (already exists)`);
  }
}

async function main() {
  console.log("Migrating: profile + settings support...");

  // ---- users: personal profile extras ----
  await addColumn("users", "photo_url", "TEXT");
  await addColumn("users", "phone", "VARCHAR(30)");

  // ---- business: clinic/business profile fields (settings page) ----
  await addColumn("business", "logo_url", "TEXT");
  await addColumn("business", "contact_number", "VARCHAR(30)");
  await addColumn("business", "full_address", "TEXT");
  await addColumn("business", "city", "VARCHAR(100)");
  await addColumn("business", "city_code", "VARCHAR(50)");
  await addColumn("business", "google_maps_url", "TEXT");

  // ---- business_settings: ONE row per business (upsert target) ----
  // JSONB groups keep the table small and future-proof; the API validates
  // every key before it is ever written.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_settings (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id  UUID NOT NULL UNIQUE REFERENCES business(id) ON DELETE CASCADE,
      notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
      appointment_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      system_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("  = business_settings table ready");

  console.log("Migration complete.");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
    return pool.end();
  });
