/**
 * Dashboard permission catalog — the SINGLE source of truth for RBAC.
 *
 * Imported by BOTH sides:
 *   - server: src/lib/rbac.ts validates saved keys and authorizes API calls
 *   - client: sidebar filtering, page gating, the staff permission checklist
 *
 * Pure data + pure functions: no I/O, no secrets, safe for client bundles.
 *
 * Permission keys are STABLE identifiers (snake_case), never display labels,
 * so renaming a label never invalidates stored permissions. Every key maps to
 * an ACTUAL existing dashboard route — removed modules are never listed.
 */

export const PERMISSIONS = [
  { key: "overview", label: "Overview / Dashboard", route: "/dashboard", exact: true, group: "MAIN" },
  { key: "appointments", label: "Appointments", route: "/dashboard/appointments", group: "MAIN" },
  { key: "calendar", label: "Calendar", route: "/dashboard/calendar", group: "MAIN" },
  { key: "patients", label: "Patients", route: "/dashboard/patients", group: "MAIN" },

  { key: "doctor_profile", label: "Doctor Profile", route: "/dashboard/doctors", group: "DOCTOR & CLINICS" },
  { key: "clinics", label: "Clinics", route: "/dashboard/clinics", group: "DOCTOR & CLINICS" },
  { key: "weekly_schedule", label: "Weekly Schedule", route: "/dashboard/weekly-schedule", group: "DOCTOR & CLINICS" },
  { key: "off_days", label: "Off-Days", route: "/dashboard/off-days", group: "DOCTOR & CLINICS" },
  { key: "special_schedules", label: "Special Schedules", route: "/dashboard/special-schedules", group: "DOCTOR & CLINICS" },
  { key: "blocked_slots", label: "Blocked Slots", route: "/dashboard/blocked-slots", group: "DOCTOR & CLINICS" },

  { key: "services", label: "Services / Treatments", route: "/dashboard/services", group: "PATIENT SERVICES" },
  { key: "emergency_alerts", label: "Emergency Alerts", route: "/dashboard/emergency-alerts", group: "PATIENT SERVICES" },

  { key: "staff_inbox", label: "Staff Inbox", route: "/dashboard/staff-inbox", group: "MANAGEMENT" },
  { key: "human_handover", label: "Human Handover", route: "/dashboard/human-handover", group: "MANAGEMENT" },
  { key: "staff", label: "Staff", route: "/dashboard/staff", group: "MANAGEMENT" },
  { key: "audit_logs", label: "Audit Logs", route: "/dashboard/audit-logs", group: "MANAGEMENT" },
  { key: "system_health", label: "System Health", route: "/dashboard/system-health", group: "MANAGEMENT" },
  { key: "settings", label: "Settings", route: "/dashboard/settings", group: "MANAGEMENT" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/** Type guard used by every server-side write path that accepts permission keys. */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

/* ---------------------------------------------------------------------- *
 * ASSIGNABLE vs. catalog-only permissions.
 *
 * The catalog above remains the SINGLE source of truth for route gating,
 * sidebar visibility and API authorization — the PAGES, APIs and sidebar
 * entries for every key above keep working exactly as before (the owner/
 * admin holds every key, and staff holding a legacy grant keep it).
 *
 * The six keys below are NO LONGER offered in the staff permission
 * checklist (Add/Edit Staff Step 2 and Manage Permissions), and the shared
 * validation (src/lib/staff.ts) rejects them on every staff write API — so
 * they cannot be re-assigned through stale checkbox state or submitted
 * manually from the frontend. All other options remain assignable.
 * ---------------------------------------------------------------------- */
export const NON_ASSIGNABLE_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "emergency_alerts", // Emergency Alerts
  "staff_inbox", // Staff Inbox
  "human_handover", // Human Handover
  "staff", // Staff
  "audit_logs", // Audit Logs
  "system_health", // System Health
]);

/** The permission options shown in the staff permission checklist (12). */
export const ASSIGNABLE_PERMISSIONS = PERMISSIONS.filter(
  (p) => !NON_ASSIGNABLE_PERMISSION_KEYS.has(p.key)
);

const ASSIGNABLE_KEY_SET: ReadonlySet<string> = new Set(
  ASSIGNABLE_PERMISSIONS.map((p) => p.key)
);

/** May this key still be granted to a staff member? */
export function isAssignablePermissionKey(value: string): boolean {
  return ASSIGNABLE_KEY_SET.has(value);
}

/**
 * Routes every authenticated user may always open — personal account pages
 * that show only the caller's own data and are not dashboard modules.
 * (/dashboard/profile is the personal profile of the CURRENT user.)
 */
export const ALWAYS_ALLOWED_ROUTES: readonly string[] = ["/dashboard/profile"];

/**
 * The permission that guards a dashboard pathname, or `null` when the path
 * is not permission-gated (personal routes / unknown paths).
 *
 * Matching is exact-or-prefix on route segments so /dashboard/doctors/123 is
 * gated by the same key as /dashboard/doctors.
 */
export function permissionForPath(pathname: string): PermissionKey | null {
  const path = pathname.split("?")[0].split("#")[0];

  for (const route of ALWAYS_ALLOWED_ROUTES) {
    if (path === route || path.startsWith(route + "/")) return null;
  }

  for (const entry of PERMISSIONS) {
    if ("exact" in entry && entry.exact) {
      // Exact-only routes (Overview) must not swallow their sub-paths.
      if (path === entry.route) return entry.key;
    } else if (path === entry.route || path.startsWith(entry.route + "/")) {
      return entry.key;
    }
  }
  return null;
}

/**
 * Client-side page gate: may a user holding `permissions` open `pathname`?
 * The server enforces the same rules on every API call — this only powers
 * the clean Access Denied screen.
 */
export function isPathAllowed(pathname: string, permissions: readonly string[]): boolean {
  const required = permissionForPath(pathname);
  if (required === null) return true;
  return permissions.includes(required);
}

/** First navigable dashboard route for a permission set (Access Denied fallback). */
export function firstAllowedRoute(permissions: readonly string[]): string {
  for (const entry of PERMISSIONS) {
    if (permissions.includes(entry.key)) return entry.route;
  }
  return "/dashboard/profile";
}
