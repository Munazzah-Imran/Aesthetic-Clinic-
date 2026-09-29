/**
 * Shared patient validation (server is the source of truth; the form reuses
 * the same rules so UI errors match the backend exactly).
 *
 * Required fields (exactly 7):
 *   fullName, gender, age, city, phone, dateOfBirth, maritalStatus
 *
 * Age is always derived from dateOfBirth (single source of truth) so the two
 * can never disagree; a client-supplied `age` is only sanity-checked.
 * Empty optional fields are normalized to `null` (never empty strings).
 *
 * Field names map 1:1 to the `patient` table columns. Medical-information
 * columns are no longer part of the form/API payload (the DB columns are
 * intentionally left untouched for compatibility).
 */

export const GENDERS = ["Male", "Female", "Other"] as const;
export const MARITAL_STATUSES = [
  "Single",
  "Married",
  "Divorced",
  "Widowed",
  "Prefer not to say",
] as const;
export const PATIENT_STATUSES = ["active", "inactive", "archived"] as const;

export type Gender = (typeof GENDERS)[number];
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export type PatientInput = {
  fullName: unknown;
  gender: unknown;
  age: unknown;
  dateOfBirth: unknown;
  maritalStatus: unknown;
  phone: unknown;
  alternatePhone: unknown;
  email: unknown;
  fullAddress: unknown;
  city: unknown;
  emergencyContactName: unknown;
  emergencyContactRelationship: unknown;
  emergencyContactPhone: unknown;
  status: unknown;
};

export type PatientValidated = {
  fullName: string;
  gender: Gender;
  age: number;
  dateOfBirth: string; // "YYYY-MM-DD"
  maritalStatus: MaritalStatus;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  fullAddress: string | null;
  city: string;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  status: PatientStatus;
};

export type PatientFieldErrors = Partial<Record<keyof PatientInput, string>>;

/** Digits, spaces, +, -, (, ) — no letters. */
const PHONE_RE = /^[+()0-9][0-9()+\- ]{4,49}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** ISO date as produced by <input type="date">. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_AGE = 120;

function asOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function optionalText(
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

function optionalPhone(
  value: unknown,
  label: string
): { error?: string; value: string | null } {
  const raw = asOptionalString(value);
  if (raw === "") return { value: null };
  if (!PHONE_RE.test(raw)) {
    return {
      error: `${label} can contain digits, spaces, +, hyphens and parentheses only.`,
      value: null,
    };
  }
  return { value: raw };
}

/** Age in whole years from a "YYYY-MM-DD" string (no timezone pitfalls). */
export function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth || !DATE_RE.test(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) {
    age -= 1;
  }
  return age >= 0 && age <= MAX_AGE ? age : null;
}

export function validatePatient(
  raw: PatientInput
): { ok: true; data: PatientValidated } | { ok: false; errors: PatientFieldErrors } {
  const errors: PatientFieldErrors = {};

  // ---- fullName (required) ----
  let fullName = "";
  if (typeof raw.fullName !== "string" || raw.fullName.trim().length === 0) {
    errors.fullName = "Full name is required.";
  } else if (raw.fullName.trim().length < 2) {
    errors.fullName = "Full name must be at least 2 characters.";
  } else if (raw.fullName.trim().length > 255) {
    errors.fullName = "Full name must be 255 characters or fewer.";
  } else {
    fullName = raw.fullName.trim();
  }

  // ---- gender (required) ----
  let gender: Gender | null = null;
  const genderRaw = asOptionalString(raw.gender);
  if (genderRaw === "") {
    errors.gender = "Gender is required.";
  } else {
    const match = GENDERS.find((g) => g === genderRaw);
    if (!match) {
      errors.gender = "Invalid gender.";
    } else {
      gender = match;
    }
  }

  // ---- dateOfBirth (required, valid date, not in the future) ----
  let dateOfBirth: string | null = null;
  const dobRaw = asOptionalString(raw.dateOfBirth);
  if (dobRaw === "") {
    errors.dateOfBirth = "Date of birth is required.";
  } else if (!DATE_RE.test(dobRaw) || Number.isNaN(new Date(dobRaw + "T00:00:00").getTime())) {
    errors.dateOfBirth = "Date of birth must be a valid date.";
  } else {
    const dob = new Date(dobRaw + "T00:00:00");
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (dob.getTime() > today.getTime()) {
      errors.dateOfBirth = "Date of birth cannot be in the future.";
    } else {
      dateOfBirth = dobRaw;
    }
  }

  // ---- age (required; derived from dateOfBirth so they always agree) ----
  let age: number | null = null;
  if (dateOfBirth !== null) {
    const derived = calculateAge(dateOfBirth);
    if (derived === null) {
      errors.dateOfBirth = "Date of birth cannot be more than 120 years in the past.";
    } else {
      age = derived;
    }
  }
  // A client-supplied age is sanity-checked but the DOB-derived value is stored.
  const ageRaw = asOptionalString(raw.age);
  if (ageRaw !== "") {
    if (!/^\d+$/.test(ageRaw)) {
      errors.age = "Age must be a whole number.";
    } else if (Number(ageRaw) > MAX_AGE) {
      errors.age = "Age must be 120 or less.";
    }
  }

  // ---- maritalStatus (required) ----
  let maritalStatus: MaritalStatus | null = null;
  const maritalRaw = asOptionalString(raw.maritalStatus);
  if (maritalRaw === "") {
    errors.maritalStatus = "Marital status is required.";
  } else {
    const match = MARITAL_STATUSES.find((m) => m === maritalRaw);
    if (!match) {
      errors.maritalStatus = "Invalid marital status.";
    } else {
      maritalStatus = match;
    }
  }

  // ---- phone / contact number (required) ----
  let phone: string | null = null;
  const phoneRaw = asOptionalString(raw.phone);
  if (phoneRaw === "") {
    errors.phone = "Contact number is required.";
  } else if (!PHONE_RE.test(phoneRaw)) {
    errors.phone = "Contact number can contain digits, spaces, +, hyphens and parentheses only.";
  } else {
    phone = phoneRaw;
  }

  // ---- city (required) ----
  let city: string | null = null;
  const cityRaw = asOptionalString(raw.city);
  if (cityRaw === "") {
    errors.city = "City is required.";
  } else if (cityRaw.length < 2) {
    errors.city = "City must be at least 2 characters.";
  } else if (cityRaw.length > 100) {
    errors.city = "City must be 100 characters or fewer.";
  } else {
    city = cityRaw;
  }

  // ---- optional fields ----
  const alternatePhone = optionalPhone(raw.alternatePhone, "Alternate phone");
  if (alternatePhone.error) errors.alternatePhone = alternatePhone.error;

  let email: string | null = null;
  const emailRaw = asOptionalString(raw.email);
  if (emailRaw !== "") {
    if (!EMAIL_RE.test(emailRaw) || emailRaw.length > 255) {
      errors.email = "Please enter a valid email address.";
    } else {
      email = emailRaw.toLowerCase();
    }
  }

  const fullAddress = optionalText(raw.fullAddress, 500, "Address");
  if (fullAddress.error) errors.fullAddress = fullAddress.error;

  const emergencyContactName = optionalText(raw.emergencyContactName, 255, "Emergency contact name");
  if (emergencyContactName.error) errors.emergencyContactName = emergencyContactName.error;
  const emergencyContactRelationship = optionalText(
    raw.emergencyContactRelationship,
    100,
    "Relationship"
  );
  if (emergencyContactRelationship.error) {
    errors.emergencyContactRelationship = emergencyContactRelationship.error;
  }
  const emergencyContactPhone = optionalPhone(raw.emergencyContactPhone, "Emergency contact phone");
  if (emergencyContactPhone.error) errors.emergencyContactPhone = emergencyContactPhone.error;

  // ---- status (defaults to active; never user-entered in the form) ----
  let status: PatientStatus = "active";
  if (raw.status !== undefined && raw.status !== null && raw.status !== "") {
    const match = PATIENT_STATUSES.find((s) => s === raw.status);
    if (!match) {
      errors.status = "Status must be active, inactive, or archived.";
    } else {
      status = match;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      fullName,
      gender: gender as Gender,
      age: age as number,
      dateOfBirth: dateOfBirth as string,
      maritalStatus: maritalStatus as MaritalStatus,
      phone: phone as string,
      alternatePhone: alternatePhone.value,
      email,
      fullAddress: fullAddress.value,
      city: city as string,
      emergencyContactName: emergencyContactName.value,
      emergencyContactRelationship: emergencyContactRelationship.value,
      emergencyContactPhone: emergencyContactPhone.value,
      status,
    },
  };
}
