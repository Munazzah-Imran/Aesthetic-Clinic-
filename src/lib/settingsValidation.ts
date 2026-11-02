/**
 * Shared validation for the Profile + Settings features (server is the source
 * of truth; the forms reuse the same rules so UI errors match the backend).
 *
 * Modules:
 *   1. Profile (users table: name, email, phone, photo)
 *   2. Business/clinic settings (business table columns)
 *   3. Password change (bcrypt hashing happens in the API, never here)
 *   4. Settings groups (business_settings JSONB payloads)
 *
 * Empty optional fields are normalized to `null` (never empty strings).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Phone: digits, spaces, +, hyphens and parentheses only (clinic rule). */
const PHONE_RE = /^[0-9+\-() ]+$/;

/** Maximum accepted image data-URL length (browser resizes before upload). */
export const MAX_IMAGE_DATA_URL_LENGTH = 1_400_000;

/** Minimum new-password length for the change-password form. */
export const MIN_PASSWORD_LENGTH = 8;

function asOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function text(
  value: unknown,
  max: number,
  label: string
): { error?: string; value: string | null } {
  const raw = asOptionalString(value);
  if (raw === "") return { value: null };
  if (raw.length > max) {
    return { error: `${label} must be ${max} characters or fewer.`, value: null };
  }
  return { value: raw };
}

/** Data URL or http(s) URL image, or null when empty. */
function image(value: unknown, label: string): { error?: string; value: string | null } {
  const raw = asOptionalString(value);
  if (raw === "") return { value: null };
  const isData = raw.startsWith("data:image/");
  const isHttp = raw.startsWith("http://") || raw.startsWith("https://");
  if (!isData && !isHttp) {
    return { error: `${label} must be an image upload or a valid image URL.`, value: null };
  }
  if (raw.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return { error: `${label} is too large. Please choose a smaller image.`, value: null };
  }
  return { value: raw };
}

function validUrl(value: unknown, label: string): { error?: string; value: string | null } {
  const raw = asOptionalString(value);
  if (raw === "") return { value: null };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: `Please enter a valid ${label}.`, value: null };
    }
  } catch {
    return { error: `Please enter a valid ${label}.`, value: null };
  }
  return { value: raw };
}

// ---------------------------------------------------------------------------
// 1. Profile
// ---------------------------------------------------------------------------

export type ProfileInput = {
  fullName: unknown;
  email: unknown;
  phone: unknown;
  photoUrl: unknown;
};

export type ProfileValidated = {
  fullName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
};

export type ProfileFieldErrors = Partial<Record<keyof ProfileInput, string>>;

export function validateProfile(raw: ProfileInput):
  | { ok: true; data: ProfileValidated }
  | { ok: false; errors: ProfileFieldErrors } {
  const errors: ProfileFieldErrors = {};

  // fullName: required, 2-100 (users.name column limit)
  const fullNameRaw = asOptionalString(raw.fullName);
  if (fullNameRaw === "") {
    errors.fullName = "Full name is required.";
  } else if (fullNameRaw.length < 2) {
    errors.fullName = "Full name must be at least 2 characters.";
  } else if (fullNameRaw.length > 100) {
    errors.fullName = "Full name must be 100 characters or fewer.";
  }

  // email: required, valid — the login identifier, so it cannot be blanked
  const emailRaw = asOptionalString(raw.email).toLowerCase();
  if (emailRaw === "") {
    errors.email = "Email address is required.";
  } else if (!EMAIL_RE.test(emailRaw)) {
    errors.email = "Please enter a valid email address.";
  } else if (emailRaw.length > 255) {
    errors.email = "Email must be 255 characters or fewer.";
  }

  // phone: optional, phone characters only (VARCHAR(30))
  const phone = text(raw.phone, 30, "Phone number");
  if (phone.error) {
    errors.phone = phone.error;
  } else if (phone.value !== null && !PHONE_RE.test(phone.value)) {
    errors.phone = "Phone can only contain digits, spaces, +, - and parentheses.";
  }

  const photo = image(raw.photoUrl, "Profile photo");
  if (photo.error) errors.photoUrl = photo.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      fullName: fullNameRaw,
      email: emailRaw,
      phone: phone.value,
      photoUrl: photo.value ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Business / clinic settings (business table columns)
// ---------------------------------------------------------------------------

export type BusinessSettingsInput = {
  businessName: unknown;
  /**
   * The business email IS the signup/login email (business.email is NOT NULL
   * UNIQUE and mirrors users.email). The API keeps the existing value, so
   * clients may omit it; a changed value is rejected by the API.
   */
  email: unknown;
  contactNumber: unknown;
  logoUrl: unknown;
  fullAddress: unknown;
  city: unknown;
  cityCode: unknown;
  googleMapsUrl: unknown;
};

export type BusinessSettingsValidated = {
  businessName: string;
  email: string | null;
  contactNumber: string | null;
  logoUrl: string | null;
  fullAddress: string | null;
  city: string | null;
  cityCode: string | null;
  googleMapsUrl: string | null;
};

export type BusinessSettingsFieldErrors = Partial<Record<keyof BusinessSettingsInput, string>>;

export function validateBusinessSettings(raw: BusinessSettingsInput):
  | { ok: true; data: BusinessSettingsValidated }
  | { ok: false; errors: BusinessSettingsFieldErrors } {
  const errors: BusinessSettingsFieldErrors = {};

  // businessName: required (business.business_name is NOT NULL)
  const businessNameRaw = asOptionalString(raw.businessName);
  if (businessNameRaw === "") {
    errors.businessName = "Clinic / business name is required.";
  } else if (businessNameRaw.length < 2) {
    errors.businessName = "Clinic / business name must be at least 2 characters.";
  } else if (businessNameRaw.length > 255) {
    errors.businessName = "Clinic / business name must be 255 characters or fewer.";
  }

  // ---- email (NOT NULL column): must remain a present, valid email. The
  // API keeps the existing value when a different one is submitted. ----
  const email = text(raw.email, 255, "Business email");
  if (email.error) {
    errors.email = email.error;
  } else if (email.value !== null && !EMAIL_RE.test(email.value)) {
    errors.email = "Please enter a valid business email address.";
  }

  // contactNumber: optional, phone characters only (VARCHAR(30))
  const contact = text(raw.contactNumber, 30, "Contact number");
  if (contact.error) {
    errors.contactNumber = contact.error;
  } else if (contact.value !== null && !PHONE_RE.test(contact.value)) {
    errors.contactNumber = "Contact number can only contain digits, spaces, +, - and parentheses.";
  }

  const logo = image(raw.logoUrl, "Logo");
  if (logo.error) errors.logoUrl = logo.error;

  const fullAddress = text(raw.fullAddress, 500, "Full address");
  if (fullAddress.error) errors.fullAddress = fullAddress.error;

  const city = text(raw.city, 100, "City");
  if (city.error) errors.city = city.error;

  // cityCode: optional; letters, numbers, hyphens, underscores (clinic rule)
  const cityCodeRaw = asOptionalString(raw.cityCode).toUpperCase();
  let cityCode: string | null = null;
  if (cityCodeRaw !== "") {
    if (!/^[A-Z0-9_-]{2,50}$/.test(cityCodeRaw)) {
      errors.cityCode = "City code can contain letters, numbers, hyphens, and underscores only (2-50 characters).";
    } else {
      cityCode = cityCodeRaw;
    }
  }

  const maps = validUrl(raw.googleMapsUrl, "Google Maps URL");
  if (maps.error) errors.googleMapsUrl = maps.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      businessName: businessNameRaw,
      email: email.value,
      contactNumber: contact.value,
      logoUrl: logo.value,
      fullAddress: fullAddress.value,
      city: city.value,
      cityCode,
      googleMapsUrl: maps.value,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Change password (hashing happens in the API route)
// ---------------------------------------------------------------------------

export type PasswordChangeInput = {
  currentPassword: unknown;
  newPassword: unknown;
  confirmPassword: unknown;
};

export type PasswordChangeFieldErrors =
  Partial<Record<keyof PasswordChangeInput, string>>;

export function validatePasswordChange(raw: PasswordChangeInput):
  | { ok: true; data: { currentPassword: string; newPassword: string } }
  | { ok: false; errors: PasswordChangeFieldErrors } {
  const errors: PasswordChangeFieldErrors = {};

  const current = typeof raw.currentPassword === "string" ? raw.currentPassword : "";
  const next = typeof raw.newPassword === "string" ? raw.newPassword : "";
  const confirm = typeof raw.confirmPassword === "string" ? raw.confirmPassword : "";

  if (current === "") {
    errors.currentPassword = "Current password is required.";
  }
  if (next === "") {
    errors.newPassword = "New password is required.";
  } else if (next.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (next.length > 72) {
    errors.newPassword = "New password must be 72 characters or fewer.";
  }
  if (confirm === "") {
    errors.confirmPassword = "Please confirm the new password.";
  } else if (next !== "" && next !== confirm) {
    errors.confirmPassword = "New password and confirmation do not match.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: { currentPassword: current, newPassword: next } };
}

// ---------------------------------------------------------------------------
// 4. Settings groups (business_settings JSONB payloads)
// ---------------------------------------------------------------------------

export const NOTIFICATION_KEYS = [
  "newAppointment",
  "appointmentCancellation",
  "newPatient",
  "system",
  "email",
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export const APPOINTMENT_DURATIONS = [15, 30, 45, 60] as const;

export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "pending"] as const;

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export const TIME_FORMATS = ["12-hour", "24-hour"] as const;
export const TIME_ZONES = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
  "UTC",
] as const;

export type SettingsPayload = {
  notifications: Partial<Record<NotificationKey, boolean>>;
  appointmentPrefs: {
    defaultDuration?: number;
    allowSameDay?: boolean;
    allowCancellation?: boolean;
    defaultStatus?: string;
  };
  systemPrefs: {
    dateFormat?: string;
    timeFormat?: string;
    timeZone?: string;
    language?: string;
  };
};

/** Pick a settings group object (must be a plain object). */
function group(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Coerce a JSON value to a boolean; anything not boolean is dropped. */
function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Validate + sanitize the whole settings payload. Unknown keys are dropped
 * (never written to the database); valid-but-partial payloads are allowed so
 * each card can save independently.
 */
export function validateSettings(raw: unknown): { ok: true; data: SettingsPayload } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Invalid settings payload." };
  }
  const body = raw as Record<string, unknown>;

  // ---- notifications ----
  const notificationsRaw = group(body.notifications);
  const notifications: SettingsPayload["notifications"] = {};
  for (const key of NOTIFICATION_KEYS) {
    const v = asBool(notificationsRaw[key]);
    if (v !== undefined) notifications[key] = v;
  }

  // ---- appointment prefs ----
  const apptRaw = group(body.appointmentPrefs);
  const appointmentPrefs: SettingsPayload["appointmentPrefs"] = {};

  const duration = apptRaw.defaultDuration;
  if (duration !== undefined) {
    const n = Number(duration);
    if (!Number.isInteger(n) || !(APPOINTMENT_DURATIONS as readonly number[]).includes(n)) {
      return { ok: false, message: "Invalid default appointment duration." };
    }
    appointmentPrefs.defaultDuration = n;
  }

  const sameDay = asBool(apptRaw.allowSameDay);
  if (sameDay !== undefined) appointmentPrefs.allowSameDay = sameDay;

  const cancel = asBool(apptRaw.allowCancellation);
  if (cancel !== undefined) appointmentPrefs.allowCancellation = cancel;

  const statusRaw = asOptionalString(apptRaw.defaultStatus);
  if (statusRaw !== "") {
    if (!(APPOINTMENT_STATUSES as readonly string[]).includes(statusRaw)) {
      return { ok: false, message: "Invalid default appointment status." };
    }
    appointmentPrefs.defaultStatus = statusRaw;
  }

  // ---- system prefs ----
  const sysRaw = group(body.systemPrefs);
  const systemPrefs: SettingsPayload["systemPrefs"] = {};

  const dateFormat = asOptionalString(sysRaw.dateFormat);
  if (dateFormat !== "") {
    if (!(DATE_FORMATS as readonly string[]).includes(dateFormat)) {
      return { ok: false, message: "Invalid date format." };
    }
    systemPrefs.dateFormat = dateFormat;
  }

  const timeFormat = asOptionalString(sysRaw.timeFormat);
  if (timeFormat !== "") {
    if (!(TIME_FORMATS as readonly string[]).includes(timeFormat)) {
      return { ok: false, message: "Invalid time format." };
    }
    systemPrefs.timeFormat = timeFormat;
  }

  const timeZone = asOptionalString(sysRaw.timeZone);
  if (timeZone !== "") {
    if (!(TIME_ZONES as readonly string[]).includes(timeZone)) {
      return { ok: false, message: "Invalid time zone." };
    }
    systemPrefs.timeZone = timeZone;
  }

  const language = asOptionalString(sysRaw.language);
  if (language !== "") {
    if (language !== "English") {
      return { ok: false, message: "Only English is supported at the moment." };
    }
    systemPrefs.language = language;
  }

  return { ok: true, data: { notifications, appointmentPrefs, systemPrefs } };
}

/** Full defaults used when no settings row exists yet (per spec). */
export const DEFAULT_SETTINGS: Required<{
  notifications: Record<NotificationKey, boolean>;
}> & {
  appointmentPrefs: Required<SettingsPayload["appointmentPrefs"]>;
  systemPrefs: Required<SettingsPayload["systemPrefs"]>;
} = {
  notifications: {
    newAppointment: true,
    appointmentCancellation: true,
    newPatient: true,
    system: true,
    email: false,
  },
  appointmentPrefs: {
    defaultDuration: 30,
    allowSameDay: true,
    allowCancellation: true,
    defaultStatus: "scheduled",
  },
  systemPrefs: {
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12-hour",
    timeZone: "Asia/Karachi",
    language: "English",
  },
};
