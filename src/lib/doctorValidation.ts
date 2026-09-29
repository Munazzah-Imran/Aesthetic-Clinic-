/**
 * Shared doctor validation (server is the source of truth; forms reuse the
 * same rules so UI errors match the backend exactly).
 *
 * Contains two modules:
 *  1. Doctor PROFILE validation  -> `doctor_profiles` table (one detailed
 *     profile per business; photo, bios, qualifications, contact).
 *  2. Doctor validation          -> `doctor` table (one light row per doctor
 *     per business; used for appointments and the doctors list).
 *
 * Empty optional fields are normalized to `null` (never empty strings).
 */

// ---------------------------------------------------------------------------
// 1. Doctor profile (doctor_profiles table)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Phone: digits, spaces, +, hyphens and parentheses only. */
const PHONE_RE = /^[0-9+\-() ]+$/;

/** Maximum accepted photo data-URL length (browser resizes before upload). */
export const MAX_PHOTO_DATA_URL_LENGTH = 1_400_000;

export type DoctorProfileInput = {
  photoUrl: unknown;
  fullName: unknown;
  professionalTitle: unknown;
  specialty: unknown;
  experience: unknown;
  qualifications: unknown;
  additionalQualifications: unknown;
  shortBio: unknown;
  fullBio: unknown;
  professionalInterests: unknown;
  areasOfExpertise: unknown;
  phone: unknown;
  email: unknown;
  languages: unknown;
};

export type DoctorProfileValidated = {
  photoUrl: string | null;
  fullName: string;
  professionalTitle: string | null;
  specialty: string | null;
  experience: string | null;
  qualifications: string | null;
  additionalQualifications: string | null;
  shortBio: string | null;
  fullBio: string | null;
  professionalInterests: string | null;
  areasOfExpertise: string | null;
  phone: string | null;
  email: string | null;
  languages: string | null;
};

export type DoctorProfileFieldErrors = Partial<Record<keyof DoctorProfileInput, string>>;

function asOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function profileText(
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

export function validateDoctorProfile(
  raw: DoctorProfileInput
): { ok: true; data: DoctorProfileValidated } | { ok: false; errors: DoctorProfileFieldErrors } {
  const errors: DoctorProfileFieldErrors = {};

  // ---- fullName (required) ----
  const fullNameRaw = asOptionalString(raw.fullName);
  if (fullNameRaw === "") {
    errors.fullName = "Doctor name is required.";
  } else if (fullNameRaw.length < 2) {
    errors.fullName = "Doctor name must be at least 2 characters.";
  } else if (fullNameRaw.length > 255) {
    errors.fullName = "Doctor name must be 255 characters or fewer.";
  }

  // ---- photoUrl (optional; data URL or http(s) URL) ----
  const photoRaw = asOptionalString(raw.photoUrl);
  if (photoRaw !== "") {
    const isData = photoRaw.startsWith("data:image/");
    const isHttp = photoRaw.startsWith("http://") || photoRaw.startsWith("https://");
    if (!isData && !isHttp) {
      errors.photoUrl = "Photo must be an image upload or a valid image URL.";
    } else if (photoRaw.length > MAX_PHOTO_DATA_URL_LENGTH) {
      errors.photoUrl = "Photo is too large. Please choose a smaller image.";
    }
  }

  const professionalTitle = profileText(raw.professionalTitle, 255, "Professional title");
  if (professionalTitle.error) errors.professionalTitle = professionalTitle.error;

  const specialty = profileText(raw.specialty, 255, "Specialty");
  if (specialty.error) errors.specialty = specialty.error;

  const experience = profileText(raw.experience, 100, "Experience");
  if (experience.error) errors.experience = experience.error;

  const qualifications = profileText(raw.qualifications, 1000, "Qualifications");
  if (qualifications.error) errors.qualifications = qualifications.error;

  const additionalQualifications = profileText(raw.additionalQualifications, 1000, "Additional qualifications");
  if (additionalQualifications.error) errors.additionalQualifications = additionalQualifications.error;

  const shortBio = profileText(raw.shortBio, 1000, "Short biography");
  if (shortBio.error) errors.shortBio = shortBio.error;

  const fullBio = profileText(raw.fullBio, 5000, "Full biography");
  if (fullBio.error) errors.fullBio = fullBio.error;

  const professionalInterests = profileText(raw.professionalInterests, 1000, "Professional interests");
  if (professionalInterests.error) errors.professionalInterests = professionalInterests.error;

  const areasOfExpertise = profileText(raw.areasOfExpertise, 1000, "Areas of expertise");
  if (areasOfExpertise.error) errors.areasOfExpertise = areasOfExpertise.error;

  // ---- phone (optional, phone characters only) ----
  // DB column is VARCHAR(30) so the limit must match it exactly.
  const phoneRaw = asOptionalString(raw.phone);
  if (phoneRaw !== "") {
    if (!PHONE_RE.test(phoneRaw)) {
      errors.phone = "Phone can only contain digits, spaces, +, - and parentheses.";
    } else if (phoneRaw.length > 30) {
      errors.phone = "Phone must be 30 characters or fewer.";
    }
  }

  // ---- email (optional, valid format) ----
  const emailRaw = asOptionalString(raw.email);
  if (emailRaw !== "") {
    if (!EMAIL_RE.test(emailRaw)) {
      errors.email = "Please enter a valid email address.";
    } else if (emailRaw.length > 255) {
      errors.email = "Email must be 255 characters or fewer.";
    }
  }

  const languages = profileText(raw.languages, 255, "Languages");
  if (languages.error) errors.languages = languages.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      photoUrl: photoRaw === "" ? null : photoRaw,
      fullName: fullNameRaw,
      professionalTitle: professionalTitle.value,
      specialty: specialty.value,
      experience: experience.value,
      qualifications: qualifications.value,
      additionalQualifications: additionalQualifications.value,
      shortBio: shortBio.value,
      fullBio: fullBio.value,
      professionalInterests: professionalInterests.value,
      areasOfExpertise: areasOfExpertise.value,
      phone: phoneRaw === "" ? null : phoneRaw,
      email: emailRaw === "" ? null : emailRaw,
      languages: languages.value,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Doctor (doctor table — one light row per doctor)
// ---------------------------------------------------------------------------

export const DOCTOR_STATUSES = ["active", "inactive"] as const;

export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export const CONSULTATION_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type ConsultationDay = (typeof CONSULTATION_DAYS)[number];

export type ConsultationScheduleInput = {
  consultationDays: unknown;
  consultationStartTime: unknown;
  consultationEndTime: unknown;
};

export type ConsultationScheduleValidated = {
  consultationDays: string | null;
  consultationStartTime: string | null;
  consultationEndTime: string | null;
};

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Shared consultation-schedule validation (used by the doctor form and APIs).
 *
 * The whole schedule is optional: an empty form stores SQL NULL for every
 * field. When any part is configured, days + start + end are required.
 */
export function validateConsultationSchedule(
  raw: ConsultationScheduleInput
): { ok: true; data: ConsultationScheduleValidated } | { ok: false; errors: Partial<Record<keyof ConsultationScheduleInput, string>> } {
  const errors: Partial<Record<keyof ConsultationScheduleInput, string>> = {};

  // ---- consultationDays ----
  const daysArray = Array.isArray(raw.consultationDays)
    ? raw.consultationDays.map((d) => String(d).trim())
    : typeof raw.consultationDays === "string" && raw.consultationDays.trim() !== ""
      ? String(raw.consultationDays).split(",").map((d) => d.trim())
      : [];
  const days = daysArray.filter((d): d is ConsultationDay =>
    (CONSULTATION_DAYS as readonly string[]).includes(d)
  );

  // ---- times ----
  const startRaw = asOptionalString(raw.consultationStartTime).slice(0, 5);
  const endRaw = asOptionalString(raw.consultationEndTime).slice(0, 5);

  // ---- cross-field rules ----
  const anyConfigured = days.length > 0 || startRaw !== "" || endRaw !== "";

  if (anyConfigured) {
    if (days.length === 0) {
      errors.consultationDays = "Select at least one consultation day.";
    }
    if (startRaw === "") {
      errors.consultationStartTime = "Consultation start time is required.";
    }
    if (endRaw === "") {
      errors.consultationEndTime = "Consultation end time is required.";
    }
    if (startRaw !== "" && !TIME_HHMM_RE.test(startRaw)) {
      errors.consultationStartTime = "Consultation start time must be a valid time.";
    }
    if (endRaw !== "" && !TIME_HHMM_RE.test(endRaw)) {
      errors.consultationEndTime = "Consultation end time must be a valid time.";
    }
  }

  if (startRaw !== "" && endRaw !== "" && TIME_HHMM_RE.test(startRaw) && TIME_HHMM_RE.test(endRaw)) {
    if (toMinutes(endRaw) <= toMinutes(startRaw)) {
      errors.consultationEndTime = "Consultation end time must be later than the start time.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // ---- normalized output (empty -> NULL, never empty strings) ----
  return {
    ok: true,
    data: {
      consultationDays: days.length > 0 ? days.join(",") : null,
      consultationStartTime: startRaw === "" ? null : startRaw,
      consultationEndTime: endRaw === "" ? null : endRaw,
    },
  };
}

export type DoctorInput = {
  fullName: unknown;
  specialty: unknown;
  professionalTitle: unknown;
  status: unknown;
} & ConsultationScheduleInput;

export type DoctorValidated = {
  fullName: string;
  specialty: string | null;
  professionalTitle: string | null;
  status: DoctorStatus;
} & ConsultationScheduleValidated;

export type DoctorFieldErrors = Partial<Record<keyof DoctorInput, string>>;

export const DOCTOR_STATUS_LABELS: Record<DoctorStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

function doctorText(value: unknown, max: number, label: string): { error?: string; value: string | null } {
  const raw = asOptionalString(value);
  if (raw === "") return { value: null };
  if (raw.length > max) {
    return { error: `${label} must be ${max} characters or fewer.`, value: null };
  }
  return { value: raw };
}

export function validateDoctor(
  raw: DoctorInput
): { ok: true; data: DoctorValidated } | { ok: false, errors: DoctorFieldErrors } {
  const errors: DoctorFieldErrors = {};

  // ---- consultation schedule (shared rules) ----
  const schedule = validateConsultationSchedule({
    consultationDays: raw.consultationDays,
    consultationStartTime: raw.consultationStartTime,
    consultationEndTime: raw.consultationEndTime,
  });
  if (!schedule.ok) {
    Object.assign(errors, schedule.errors);
  }

  // fullName: required, trimmed, 2-255
  const fullNameRaw = asOptionalString(raw.fullName);
  if (fullNameRaw === "") {
    errors.fullName = "Doctor name is required.";
  } else if (fullNameRaw.length < 2) {
    errors.fullName = "Doctor name must be at least 2 characters.";
  } else if (fullNameRaw.length > 255) {
    errors.fullName = "Doctor name must be 255 characters or fewer.";
  }

  const specialty = doctorText(raw.specialty, 255, "Specialty");
  if (specialty.error) errors.specialty = specialty.error;

  const professionalTitle = doctorText(raw.professionalTitle, 255, "Professional title");
  if (professionalTitle.error) errors.professionalTitle = professionalTitle.error;

  // status: required enum, default active
  let status: DoctorStatus = "active";
  const statusRaw = asOptionalString(raw.status);
  if (statusRaw !== "") {
    const match = DOCTOR_STATUSES.find((s) => s === statusRaw);
    if (!match) {
      errors.status = "Invalid status.";
    } else {
      status = match;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  if (Object.keys(errors).length > 0 || !schedule.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      fullName: fullNameRaw,
      specialty: specialty.value,
      professionalTitle: professionalTitle.value,
      status,
      ...schedule.data,
    },
  };
}
