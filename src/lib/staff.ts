/**
 * Staff Management — shared types + validation used by BOTH the staff form
 * (client) and the staff API routes (server). Pure data/functions: safe for
 * client bundles, no secrets, no I/O.
 *
 * Permission keys are validated against the shared catalog, never trusted
 * from the client: only keys in src/lib/permissions.ts can ever be saved.
 */

import {
  isAssignablePermissionKey,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissions";

export type AccountStatus = "active" | "inactive";

export const ACCOUNT_STATUSES: AccountStatus[] = ["active", "inactive"];

/** Preset designations offered in the Add/Edit Staff form (custom allowed). */
export const DESIGNATION_PRESETS = [
  "Receptionist",
  "Doctor",
  "Nurse",
  "Clinic Manager",
  "Accountant",
  "Lab Technician",
  "Other",
] as const;

/** One row of GET /api/staff / GET /api/staff/[id] (never contains secrets). */
export type StaffRecord = {
  /** Stable UUID staff API handle (users.staff_uuid) — same shape the UI/
   *  routes/tests already expect, so the staff API URL format stays UUID-based.
   *  Page permissions are keyed by users.id (integer) instead (see staffDb).
   */
  id: string; // users.staff_uuid
  /** Human-readable staff ID: STF-YYYYMMDD-XXXX (users.staff_id). */
  staffId: string;
  /** The underlying users.id (integer) — the key for staff_permissions.
   *  Stored here so callers that need the integer PK can read it; the public
   *  staff API handle is `id` (staff_uuid), not this.
   */
  userId: number;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string;
  role: "staff" | "admin";
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
};

export type StaffFieldErrors = Partial<
  Record<
    "fullName" | "email" | "phone" | "designation" | "accountStatus" | "password" | "confirmPassword" | "permissions",
    string
  >
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffDetailsInput = {
  fullName: unknown;
  email: unknown;
  phone: unknown;
  designation: unknown;
  accountStatus: unknown;
};

export type StaffDetails = {
  fullName: string;
  email: string;
  phone: string | null;
  designation: string;
  accountStatus: AccountStatus;
};

/** Validates the personal/details part of the Add/Edit Staff form. */
export function validateStaffDetails(
  raw: StaffDetailsInput
): { ok: true; data: StaffDetails } | { ok: false; errors: StaffFieldErrors } {
  const errors: StaffFieldErrors = {};

  const fullName = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (!fullName) errors.fullName = "Full name is required";
  else if (fullName.length > 100) errors.fullName = "Full name must be 100 characters or fewer";

  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!email) errors.email = "Email address is required";
  else if (!EMAIL_RE.test(email)) errors.email = "Please enter a valid email address";
  else if (email.length > 255) errors.email = "Email must be 255 characters or fewer";

  const rawPhone = typeof raw.phone === "string" ? raw.phone.trim() : "";
  if (rawPhone.length > 30) errors.phone = "Phone number must be 30 characters or fewer";

  const designation = typeof raw.designation === "string" ? raw.designation.trim() : "";
  if (!designation) errors.designation = "Designation / field is required";
  else if (designation.length > 100) errors.designation = "Designation must be 100 characters or fewer";

  const accountStatus =
    typeof raw.accountStatus === "string" && (raw.accountStatus === "active" || raw.accountStatus === "inactive")
      ? (raw.accountStatus as AccountStatus)
      : null;
  if (!accountStatus) errors.accountStatus = "Account status must be Active or Inactive";

  if (accountStatus === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      fullName,
      email,
      phone: rawPhone === "" ? null : rawPhone,
      designation,
      accountStatus,
    },
  };
}

/**
 * Initial (temporary) password for a NEW staff login account.
 * Server stores only the bcrypt hash; the value is never returned or logged.
 */
export function validateInitialPassword(
  password: unknown,
  confirmPassword: unknown
): { ok: true; password: string } | { ok: false; errors: StaffFieldErrors } {
  const errors: StaffFieldErrors = {};
  const pwd = typeof password === "string" ? password : "";
  const confirm = typeof confirmPassword === "string" ? confirmPassword : "";

  if (!pwd) errors.password = "Initial password is required";
  else if (pwd.length < 8) errors.password = "Password must be at least 8 characters";
  else if (pwd.length > 72) errors.password = "Password must be 72 characters or fewer";

  if (!confirm) errors.confirmPassword = "Please confirm the password";
  else if (pwd !== confirm) errors.confirmPassword = "Passwords do not match";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, password: pwd };
}

/**
 * Validates a requested permission list against the catalog.
 * Unknown keys are rejected (never silently saved), keys that are no longer
 * assignable (removed from the staff checklist) are rejected as well — this
 * is the shared client+server guard, so a hand-crafted frontend payload
 * cannot grant one of the removed options either. Duplicates are removed,
 * and an empty list is allowed (a staff member may start with zero pages —
 * permissions are ONLY what the admin explicitly assigns).
 */
export function validatePermissionKeys(
  raw: unknown
): { ok: true; keys: PermissionKey[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Permissions must be a list of permission keys" };
  }
  const unique = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !isPermissionKey(entry)) {
      return { ok: false, message: "One or more permission keys are not recognized" };
    }
    if (!isAssignablePermissionKey(entry)) {
      return {
        ok: false,
        message: "One or more permission options are no longer available for assignment",
      };
    }
    unique.add(entry);
  }
  return { ok: true, keys: Array.from(unique) as PermissionKey[] };
}
