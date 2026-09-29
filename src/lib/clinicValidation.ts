/**
 * Shared clinic validation (server is the source of truth; the form reuses
 * the same rules so UI errors match the backend exactly).
 *
 * Field names map 1:1 to the existing `clinic` table columns:
 *   clinic_name, city, city_code, contact_number, full_clinic_address,
 *   working_days, status, google_map_url, latitude, longitude.
 */

export const WORKING_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WorkingDay = (typeof WORKING_DAYS)[number];

export const CLINIC_STATUSES = ["active", "coming_soon", "inactive"] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

export type ClinicInput = {
  clinicName: unknown;
  city: unknown;
  cityCode: unknown;
  contactNumber: unknown;
  fullClinicAddress: unknown;
  workingDays: unknown;
  openingTime: unknown;
  closingTime: unknown;
  status: unknown;
  googleMapUrl: unknown;
  latitude: unknown;
  longitude: unknown;
};

export type ClinicValidated = {
  clinicName: string;
  city: string;
  cityCode: string;
  contactNumber: string;
  fullClinicAddress: string;
  workingDays: string; // stored as "Monday,Tuesday,..." (canonical order)
  openingTime: string | null; // "HH:MM" 24h, NULL when left empty
  closingTime: string | null; // "HH:MM" 24h, NULL when left empty
  status: ClinicStatus;
  googleMapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ClinicFieldErrors = Partial<Record<keyof ClinicInput, string>>;

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const PHONE_RE = /^\+?[0-9][0-9\- ]{5,25}$/;
const CODE_RE = /^[A-Z0-9_-]{2,50}$/;

function asOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function validateClinic(
  raw: ClinicInput
): { ok: true; data: ClinicValidated } | { ok: false; errors: ClinicFieldErrors } {
  const errors: ClinicFieldErrors = {};

  // ---- clinicName (required) ----
  let clinicName = "";
  if (typeof raw.clinicName !== "string" || raw.clinicName.trim().length === 0) {
    errors.clinicName = "Clinic name is required.";
  } else if (raw.clinicName.trim().length < 2) {
    errors.clinicName = "Clinic name must be at least 2 characters.";
  } else if (raw.clinicName.trim().length > 255) {
    errors.clinicName = "Clinic name must be 255 characters or fewer.";
  } else {
    clinicName = raw.clinicName.trim();
  }

  // ---- city (required) ----
  let city = "";
  if (typeof raw.city !== "string" || raw.city.trim().length === 0) {
    errors.city = "City is required.";
  } else if (raw.city.trim().length < 2) {
    errors.city = "City must be at least 2 characters.";
  } else if (raw.city.trim().length > 100) {
    errors.city = "City must be 100 characters or fewer.";
  } else {
    city = raw.city.trim();
  }

  // ---- cityCode (required) ----
  let cityCode = "";
  if (typeof raw.cityCode !== "string" || raw.cityCode.trim().length === 0) {
    errors.cityCode = "City code is required.";
  } else {
    const code = raw.cityCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      errors.cityCode =
        "City code can contain letters, numbers, hyphens, and underscores only (2-50 characters).";
    } else {
      cityCode = code;
    }
  }

  // ---- contactNumber (required) ----
  let contactNumber = "";
  if (typeof raw.contactNumber !== "string" || raw.contactNumber.trim().length === 0) {
    errors.contactNumber = "Contact number is required.";
  } else if (!PHONE_RE.test(raw.contactNumber.trim())) {
    errors.contactNumber = "Please enter a valid contact number.";
  } else {
    contactNumber = raw.contactNumber.trim();
  }

  // ---- fullClinicAddress (required) ----
  let fullClinicAddress = "";
  if (
    typeof raw.fullClinicAddress !== "string" ||
    raw.fullClinicAddress.trim().length === 0
  ) {
    errors.fullClinicAddress = "Clinic address is required.";
  } else if (raw.fullClinicAddress.trim().length < 5) {
    errors.fullClinicAddress = "Clinic address must be at least 5 characters.";
  } else if (raw.fullClinicAddress.trim().length > 500) {
    errors.fullClinicAddress = "Clinic address must be 500 characters or fewer.";
  } else {
    fullClinicAddress = raw.fullClinicAddress.trim();
  }

  // ---- workingDays (required) ----
  let workingDays = "";
  if (
    !Array.isArray(raw.workingDays) ||
    raw.workingDays.length === 0 ||
    !raw.workingDays.every((d) => WORKING_DAYS.includes(d as WorkingDay))
  ) {
    errors.workingDays = "Please select at least one working day.";
  } else {
    const selectedDays = raw.workingDays as unknown[];
    const days = WORKING_DAYS.filter((d) => selectedDays.includes(d));
    workingDays = days.join(",");
  }

  // ---- openingTime / closingTime (optional -> NULL when empty) ----
  let openingTime: string | null = null;
  let closingTime: string | null = null;
  const openingRaw = asOptionalString(raw.openingTime);
  const closingRaw = asOptionalString(raw.closingTime);
  if (openingRaw !== "" && !TIME_RE.test(openingRaw)) {
    errors.openingTime = "Opening time must be a valid time (HH:MM).";
  } else {
    openingTime = openingRaw === "" ? null : openingRaw;
  }
  if (closingRaw !== "" && !TIME_RE.test(closingRaw)) {
    errors.closingTime = "Closing time must be a valid time (HH:MM).";
  } else {
    closingTime = closingRaw === "" ? null : closingRaw;
  }
  if (
    openingTime !== null &&
    closingTime !== null &&
    closingTime <= openingTime
  ) {
    errors.closingTime = "Closing time must be after opening time.";
  }

  // ---- status (required, defaults to active) ----
  let status: ClinicStatus = "active";
  if (raw.status !== undefined && raw.status !== null && raw.status !== "") {
    if (typeof raw.status !== "string" || !CLINIC_STATUSES.includes(raw.status as ClinicStatus)) {
      errors.status = "Invalid status.";
    } else {
      status = raw.status as ClinicStatus;
    }
  }

  // ---- googleMapUrl (optional -> NULL when empty) ----
  let googleMapUrl: string | null = null;
  const urlRaw = asOptionalString(raw.googleMapUrl);
  if (urlRaw !== "") {
    let okUrl = false;
    try {
      const parsed = new URL(urlRaw);
      okUrl = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      okUrl = false;
    }
    if (!okUrl) {
      errors.googleMapUrl = "Please enter a valid Google Maps URL.";
    } else {
      googleMapUrl = urlRaw;
    }
  }

  // ---- latitude / longitude (optional -> NULL; provided together) ----
  let latitude: number | null = null;
  let longitude: number | null = null;
  const latRaw = asOptionalString(raw.latitude);
  const lonRaw = asOptionalString(raw.longitude);
  const latProvided = latRaw !== "";
  const lonProvided = lonRaw !== "";

  if (latProvided !== lonProvided) {
    errors.latitude = "Latitude and longitude must be provided together.";
  }
  if (latProvided) {
    const lat = Number(latRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.latitude = "Latitude must be between -90 and 90.";
    } else {
      latitude = lat;
    }
  }
  if (lonProvided) {
    const lon = Number(lonRaw);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      errors.longitude = "Longitude must be between -180 and 180.";
    } else {
      longitude = lon;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      clinicName,
      city,
      cityCode,
      contactNumber,
      fullClinicAddress,
      workingDays,
      openingTime,
      closingTime,
      status,
      googleMapUrl,
      latitude,
      longitude,
    },
  };
}
