/**
 * Server-only helpers for the `emergency_alert` table (Urgent Dermatology
 * Alerts Log). The database has NO emergency alert table today (inspected:
 * business/users/patient/appointment/doctor/clinic/uploaded_report/
 * service/virtual_consultation/… only), so this module bootstraps the single
 * home for alerts — idempotent, exactly like `ensureReportTable()`.
 *
 * Every row belongs to ONE business through `business_id` (UUID FK, ON
 * DELETE CASCADE). Patient, appointment and clinic are all OPTIONAL links
 * to the EXISTING rows (an alert may not be patient-specific): names and
 * phone numbers are always read through JOINs, never duplicated, and a
 * missing link renders as "—" instead of invented data.
 *
 * Everything here is idempotent and never deletes existing rows.
 */
import pool from "@/lib/db";
import { ensureIdSequences } from "@/lib/idSequences";
import type { EmergencyAlertRow } from "@/lib/emergencyAlerts";

let tableEnsured = false;

/**
 * Idempotent bootstrap for `emergency_alert` (same philosophy as
 * scripts/db-init.ts: safe to run repeatedly, only creates what is missing).
 *
 * - FK: business_id -> business(id) ON DELETE CASCADE.
 * - FK: patient_id -> patient(id) ON DELETE SET NULL (optional link; if the
 *   patient is deleted the alert stays and shows "—", never a fake name).
 * - FK: appointment_id -> appointment(id) ON DELETE SET NULL (optional).
 * - FK: clinic_id -> clinic(id) ON DELETE SET NULL (optional).
 * - UNIQUE (business_id, alert_id): the final guard behind the ALR sequence.
 *
 * After the table exists, the ALR sequence is fast-forwarded past any
 * alert_id already stored (forward-only; existing rows are inspected, never
 * modified), so a new alert ID can never collide with a pre-existing one.
 */
export async function ensureEmergencyAlertTable(): Promise<void> {
  if (tableEnsured) return;

  const businessTable = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'business' LIMIT 1"
  );
  if ((businessTable.rowCount ?? 0) === 0) {
    // The business table itself has not been bootstrapped yet — try again later.
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS emergency_alert (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
      patient_id       UUID REFERENCES patient(id) ON DELETE SET NULL,
      appointment_id   UUID REFERENCES appointment(id) ON DELETE SET NULL,
      clinic_id        UUID REFERENCES clinic(id) ON DELETE SET NULL,
      alert_id         VARCHAR(50) NOT NULL,
      priority         VARCHAR(20) NOT NULL
                       CHECK (priority IN ('critical', 'high', 'medium', 'low')),
      alert_message    TEXT NOT NULL,
      status           VARCHAR(20) NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'acknowledged', 'in_progress', 'resolved', 'dismissed')),
      resolution_notes TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at      TIMESTAMPTZ,
      UNIQUE (business_id, alert_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS emergency_alert_business_idx
      ON emergency_alert (business_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS emergency_alert_patient_idx
      ON emergency_alert (patient_id)
  `);

  // Fast-forward the ALR sequence past every alert_id that already exists
  // (idempotent + forward-only). Runs in its own transaction because
  // ensureIdSequences takes a transaction-scoped advisory lock — same
  // pattern as reportsDb.ts / virtualConsultationsDb.ts.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureIdSequences(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  tableEnsured = true;
}

/**
 * JOIN selecting one alert with its display data. Patient name/phone come
 * from the EXISTING patient row; the appointment and clinic links are
 * OPTIONAL (LEFT JOINs render as NULL and display as "—"). The clinic name
 * falls back to the related appointment's clinic when the alert itself has
 * no explicit clinic — still a real database row, never fabricated.
 */
const SELECT_WITH_JOINS = `
  SELECT ea.id,
         ea.business_id,
         ea.patient_id,
         ea.appointment_id,
         ea.clinic_id,
         ea.alert_id,
         ea.priority,
         ea.alert_message,
         ea.status,
         ea.resolution_notes,
         ea.created_at,
         ea.updated_at,
         ea.resolved_at,
         p.full_name AS patient_full_name,
         p.patient_id AS patient_code,
         p.phone      AS patient_phone,
         a.appointment_id AS appointment_code,
         a.appointment_date::text AS appointment_date,
         a.appointment_time::text AS appointment_time,
         COALESCE(c.clinic_name, ac.clinic_name) AS clinic_name
    FROM emergency_alert ea
    LEFT JOIN patient p ON p.id = ea.patient_id
    LEFT JOIN appointment a ON a.id = ea.appointment_id
    LEFT JOIN clinic c ON c.id = ea.clinic_id
    LEFT JOIN clinic ac ON ac.id = a.clinic_id`;

/**
 * Loads every alert of the authenticated business, newest first.
 *
 * Business isolation: WHERE business_id = $1 — the business id comes from
 * the authenticated user, never from the request.
 */
export async function loadAlerts(businessId: string): Promise<EmergencyAlertRow[]> {
  await ensureEmergencyAlertTable();

  const result = await pool.query<EmergencyAlertRow>(
    `${SELECT_WITH_JOINS}
      WHERE ea.business_id = $1
      ORDER BY ea.created_at DESC, ea.id DESC`,
    [businessId]
  );
  return result.rows;
}

/**
 * Loads ONE alert (with display data) of the authenticated business, or
 * null when it does not exist / belongs to another business.
 */
export async function loadAlert(
  businessId: string,
  alertUuid: string
): Promise<EmergencyAlertRow | null> {
  await ensureEmergencyAlertTable();

  const result = await pool.query<EmergencyAlertRow>(
    `${SELECT_WITH_JOINS}
      WHERE ea.id = $1 AND ea.business_id = $2
      LIMIT 1`,
    [alertUuid, businessId]
  );
  return result.rows[0] ?? null;
}
