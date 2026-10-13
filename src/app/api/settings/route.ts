import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission, SETTINGS_READERS } from "@/lib/rbac";
import {
  validateBusinessSettings,
  validateSettings,
  DEFAULT_SETTINGS,
  type SettingsPayload,
} from "@/lib/settingsValidation";

export const dynamic = "force-dynamic";

/**
 * Clinic/business settings + global preferences for the authenticated user.
 *
 *   GET   /api/settings — business row (clinic settings) + settings groups
 *   PATCH /api/settings — update whichever groups the body contains:
 *                         { business?: {...}, settings?: {...} }
 *
 * business_id ALWAYS comes from the JWT via users.business_id — never from
 * the request body. business_settings is ONE row per business (upserted);
 * nothing here duplicates the clinic locations feature.
 */

type BusinessRow = {
  id: string;
  business_name: string;
  email: string;
  contact_number: string | null;
  logo_url: string | null;
  full_address: string | null;
  city: string | null;
  city_code: string | null;
  google_maps_url: string | null;
};

type SettingsRow = {
  notifications: Record<string, unknown> | null;
  appointment_prefs: Record<string, unknown> | null;
  system_prefs: Record<string, unknown> | null;
};

function ok(data: unknown, message: string) {
  return NextResponse.json({ success: true, data, error: null, message });
}

function fail(status: number, message: string) {
  return NextResponse.json({ success: false, data: null, error: message, message }, { status });
}

function mapBusiness(row: BusinessRow) {
  return {
    businessName: row.business_name,
    email: row.email,
    contactNumber: row.contact_number,
    logoUrl: row.logo_url,
    fullAddress: row.full_address,
    city: row.city,
    cityCode: row.city_code,
    googleMapsUrl: row.google_maps_url,
  };
}

/** Merge stored JSONB groups over the spec defaults. */
function mapSettings(row: SettingsRow | undefined): Required<SettingsPayload> {
  const notifications = { ...DEFAULT_SETTINGS.notifications };
  const appointmentPrefs = { ...DEFAULT_SETTINGS.appointmentPrefs };
  const systemPrefs = { ...DEFAULT_SETTINGS.systemPrefs };

  if (row?.notifications) Object.assign(notifications, row.notifications);
  if (row?.appointment_prefs) Object.assign(appointmentPrefs, row.appointment_prefs);
  if (row?.system_prefs) Object.assign(systemPrefs, row.system_prefs);

  return { notifications, appointmentPrefs, systemPrefs };
}

async function loadBusinessId(userId: number): Promise<string | null> {
  const result = await pool.query<{ business_id: string | null }>(
    "SELECT business_id FROM users WHERE id = $1 LIMIT 1",
    [userId]
  );
  return result.rows[0]?.business_id ?? null;
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, SETTINGS_READERS);
    if (!auth.ok) return fail(auth.status, auth.message);

    const businessId = await loadBusinessId(auth.user.id);
    if (!businessId) {
      return fail(400, "No business associated with this account.");
    }

    // business row + settings row load together (settings row may not exist).
    const [businessResult, settingsResult] = await Promise.all([
      pool.query<BusinessRow>(
        `SELECT id, business_name, email, contact_number, logo_url,
                full_address, city, city_code, google_maps_url
           FROM business WHERE id = $1 LIMIT 1`,
        [businessId]
      ),
      pool.query<SettingsRow>(
        `SELECT notifications, appointment_prefs, system_prefs
           FROM business_settings WHERE business_id = $1 LIMIT 1`,
        [businessId]
      ),
    ]);

    const business = businessResult.rows[0];
    if (!business) return fail(404, "Business not found.");

    return ok(
      {
        business: { ...mapBusiness(business), emailLocked: true },
        settings: mapSettings(settingsResult.rows[0]),
      },
      "Settings loaded."
    );
  } catch (error) {
    console.error("GET /api/settings failed:", error);
    return fail(500, "Unable to load settings. Please try again.");
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requirePermission(request, "settings");
    if (!auth.ok) return fail(auth.status, auth.message);

    const businessId = await loadBusinessId(auth.user.id);
    if (!businessId) {
      return fail(400, "No business associated with this account.");
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body ?? {}) as Record<string, unknown>;

    // ---- Part 1: clinic/business settings (business table columns) ----
    if (raw.business !== undefined) {
      const bRaw = (typeof raw.business === "object" && raw.business !== null ? raw.business : {}) as Record<string, unknown>;
      const validated = validateBusinessSettings({
        businessName: bRaw.businessName,
        email: bRaw.email,
        contactNumber: bRaw.contactNumber,
        logoUrl: bRaw.logoUrl,
        fullAddress: bRaw.fullAddress,
        city: bRaw.city,
        cityCode: bRaw.cityCode,
        googleMapsUrl: bRaw.googleMapsUrl,
      });
      if (!validated.ok) {
        return NextResponse.json(
          {
            success: false,
            data: { errors: validated.errors },
            error: "Please fix the highlighted fields.",
            message: "Please fix the highlighted fields.",
          },
          { status: 400 }
        );
      }
      const v = validated.data;

      // business.email is the signup/login email (NOT NULL UNIQUE and mirrors
      // users.email). A client-submitted different email is ignored — the
      // existing value is kept; personal email changes live on /api/profile.
      const current = await pool.query<{ email: string }>(
        "SELECT email FROM business WHERE id = $1 LIMIT 1",
        [businessId]
      );
      const effectiveEmail = current.rows[0]?.email ?? v.email;

      await pool.query(
        `UPDATE business
            SET business_name = $2, email = $3, contact_number = $4, logo_url = $5,
                full_address = $6, city = $7, city_code = $8, google_maps_url = $9
          WHERE id = $1`,
        [businessId, v.businessName, effectiveEmail, v.contactNumber, v.logoUrl,
         v.fullAddress, v.city, v.cityCode, v.googleMapsUrl]
      );
    }

    // ---- Part 2: preference groups (business_settings, upsert + merge) ----
    if (raw.settings !== undefined) {
      const validated = validateSettings(raw.settings);
      if (!validated.ok) return fail(400, validated.message);
      const s = validated.data;

      // Merge on top of the existing row so each card can save independently.
      const existing = await pool.query<SettingsRow>(
        `SELECT notifications, appointment_prefs, system_prefs
           FROM business_settings WHERE business_id = $1 LIMIT 1`,
        [businessId]
      );
      const merged = mapSettings(existing.rows[0]);
      Object.assign(merged.notifications, s.notifications);
      Object.assign(merged.appointmentPrefs, s.appointmentPrefs);
      Object.assign(merged.systemPrefs, s.systemPrefs);

      await pool.query(
        `INSERT INTO business_settings (business_id, notifications, appointment_prefs, system_prefs)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
         ON CONFLICT (business_id) DO UPDATE SET
           notifications = EXCLUDED.notifications,
           appointment_prefs = EXCLUDED.appointment_prefs,
           system_prefs = EXCLUDED.system_prefs,
           updated_at = NOW()`,
        [
          businessId,
          JSON.stringify(merged.notifications),
          JSON.stringify(merged.appointmentPrefs),
          JSON.stringify(merged.systemPrefs),
        ]
      );
    }

    if (raw.business === undefined && raw.settings === undefined) {
      return fail(400, "Nothing to update.");
    }

    // Return the fresh combined state so the UI stays in sync without a reload.
    const [businessResult, settingsResult] = await Promise.all([
      pool.query<BusinessRow>(
        `SELECT id, business_name, email, contact_number, logo_url,
                full_address, city, city_code, google_maps_url
           FROM business WHERE id = $1 LIMIT 1`,
        [businessId]
      ),
      pool.query<SettingsRow>(
        `SELECT notifications, appointment_prefs, system_prefs
           FROM business_settings WHERE business_id = $1 LIMIT 1`,
        [businessId]
      ),
    ]);

    return ok(
      {
        business: mapBusiness(businessResult.rows[0]),
        settings: mapSettings(settingsResult.rows[0]),
      },
      "Settings saved successfully."
    );
  } catch (error) {
    console.error("PATCH /api/settings failed:", error);
    return fail(500, "Unable to save settings. Please try again.");
  }
}
