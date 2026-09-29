"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Trash2, User } from "lucide-react";
import {
  validateDoctorProfile,
  validateConsultationSchedule,
  type DoctorProfileFieldErrors,
} from "@/lib/doctorValidation";
import ConsultationScheduleFields, {
  EMPTY_SCHEDULE,
  type ScheduleValues,
} from "@/components/dashboard/ConsultationScheduleFields";

export type DoctorProfileValues = {
  photoUrl: string;
  fullName: string;
  professionalTitle: string;
  specialty: string;
  experience: string;
  qualifications: string;
  additionalQualifications: string;
  shortBio: string;
  fullBio: string;
  professionalInterests: string;
  areasOfExpertise: string;
  phone: string;
  email: string;
  languages: string;
};

/** Consultation schedule lives alongside the profile values (see DB columns). */
type ProfileFormValues = DoctorProfileValues & { schedule: ScheduleValues };

export const EMPTY_DOCTOR_PROFILE: DoctorProfileValues = {
  photoUrl: "",
  fullName: "",
  professionalTitle: "",
  specialty: "",
  experience: "",
  qualifications: "",
  additionalQualifications: "",
  shortBio: "",
  fullBio: "",
  professionalInterests: "",
  areasOfExpertise: "",
  phone: "",
  email: "",
  languages: "",
};

type DoctorProfileFormProps = {
  values: DoctorProfileValues;
  errors: DoctorProfileFieldErrors;
  onChange: <K extends keyof DoctorProfileValues>(key: K, value: string) => void;
  onErrors: (errors: DoctorProfileFieldErrors) => void;
  onSave: (values: DoctorProfileValues) => Promise<string | null>;
  onPhotoRemoved: () => void;
  /** Consultation schedule is owned by the page so it resets with each doctor. */
  schedule: ScheduleValues;
  scheduleErrors: Partial<Record<keyof ScheduleValues, string | undefined>>;
  onScheduleChange: <K extends keyof ScheduleValues>(key: K, value: ScheduleValues[K]) => void;
  onScheduleErrors: (errors: Partial<Record<keyof ScheduleValues, string | undefined>>) => void;
};

/**
 * NOTE: Field stays defined outside DoctorProfileForm on purpose — defining
 * it inline would remount inputs on every keystroke and inputs would lose
 * focus (same bug as the clinic form).
 */
function Field({
  label,
  error,
  hint,
  children,
  span2 = false,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[11px] text-[#83909D]">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Photos are resized to this square (JPEG q0.85) before being saved. */
const PHOTO_SIZE = 512;

/** Reads a File and returns a resized JPEG data URL. */
async function resizeToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image."));
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the image.");

    // Center-crop to a square, then scale into the canvas.
    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    ctx.drawImage(image, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function DoctorProfileForm({
  values,
  errors,
  onChange,
  onErrors,
  onSave,
  onPhotoRemoved,
  schedule,
  scheduleErrors,
  onScheduleChange,
  onScheduleErrors,
}: DoctorProfileFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  function set<K extends keyof DoctorProfileValues>(key: K, value: string) {
    onChange(key, value);
    onErrors({ ...errors, [key]: undefined });
  }

  async function handlePhotoFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError("Accepts JPG, PNG, WEBP only.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError("Image is too large (max 10MB).");
      return;
    }
    setResizing(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      set("photoUrl", dataUrl);
    } catch {
      setPhotoError("Could not process this image. Please try another one.");
    } finally {
      setResizing(false);
    }
  }

  function removePhoto() {
    setPhotoError(null);
    onChange("photoUrl", "");
    onPhotoRemoved();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // prevent duplicate submission

    const result = validateDoctorProfile({ ...values });
    const scheduleResult = validateConsultationSchedule({
      consultationDays: schedule.consultationDays,
      consultationStartTime: schedule.consultationStartTime,
      consultationEndTime: schedule.consultationEndTime,
    });
    if (!result.ok || !scheduleResult.ok) {
      onErrors(result.ok ? {} : result.errors);
      onScheduleErrors(scheduleResult.ok ? {} : scheduleResult.errors);
      return;
    }

    setSaving(true);
    setTopError(null);
    const errorMessage = await onSave(values);
    setSaving(false);

    if (errorMessage) {
      setTopError(errorMessage);
    }
  }

  const inputClass = (hasError: boolean) =>
    `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder-[#83909D] outline-none transition-colors ${hasError
      ? "border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
      : "border-[#E2E8F0] focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/15"
    }`;

  const initials = values.fullName
    .split(/\s+/)
    .filter((w) => w.length > 0 && w.toLowerCase() !== "dr.")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 1. Doctor Profile Photo */}
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Doctor Profile Photo</h2>
        <div className="mt-4 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-[#E2E8F0] bg-[#F1F5F9]">
            {values.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={values.photoUrl}
                alt="Doctor profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-sky-500/10 text-sky-600">
                {values.fullName ? (
                  <span className="text-2xl font-bold">{initials}</span>
                ) : (
                  <User size={34} />
                )}
              </div>
            )}
            {resizing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2 text-xs font-semibold text-[#0369A1] transition-colors hover:border-sky-500/40 hover:text-sky-600"
            >
              <Camera size={14} />
              {values.photoUrl ? "Upload / Replace Image" : "Upload / Replace Image"}
            </button>
            {values.photoUrl && (
              <button
                type="button"
                onClick={removePhoto}
                className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20"
              >
                <Trash2 size={14} /> Remove Photo
              </button>
            )}
            <p className="w-full text-[11px] text-[#83909D]">
              Accepts JPG, PNG, WEBP. Photo is stored with the profile in PostgreSQL.
            </p>
          </div>
        </div>
        {photoError && <p className="mt-2 text-xs text-red-600">{photoError}</p>}
        {errors.photoUrl && <p className="mt-2 text-xs text-red-600">{errors.photoUrl}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
        />
      </section>

      {/* 2–11. Text fields */}
      <section className="grid gap-4 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:grid-cols-2 md:p-6">
        <Field label="Doctor Full Name" error={errors.fullName}>
          <input
            type="text"
            value={values.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            placeholder="Dr. Ayesha Rahman"
            maxLength={255}
            className={inputClass(!!errors.fullName)}
          />
        </Field>

        <Field label="Professional Title" error={errors.professionalTitle}>
          <input
            type="text"
            value={values.professionalTitle}
            onChange={(e) => set("professionalTitle", e.target.value)}
            placeholder="Consultant Dermatologist & Aesthetic Physician"
            maxLength={255}
            className={inputClass(!!errors.professionalTitle)}
          />
        </Field>

        <Field label="Specialty" error={errors.specialty}>
          <input
            type="text"
            value={values.specialty}
            onChange={(e) => set("specialty", e.target.value)}
            placeholder="Dermatology"
            maxLength={255}
            className={inputClass(!!errors.specialty)}
          />
        </Field>

        <Field label="Experience" error={errors.experience}>
          <input
            type="text"
            value={values.experience}
            onChange={(e) => set("experience", e.target.value)}
            placeholder="10+ Years"
            maxLength={100}
            className={inputClass(!!errors.experience)}
          />
        </Field>

        <Field label="Qualifications" error={errors.qualifications}>
          <input
            type="text"
            value={values.qualifications}
            onChange={(e) => set("qualifications", e.target.value)}
            placeholder="MBBS, FCPS (Dermatology)"
            maxLength={1000}
            className={inputClass(!!errors.qualifications)}
          />
        </Field>

        <Field label="Additional Qualifications" error={errors.additionalQualifications}>
          <input
            type="text"
            value={values.additionalQualifications}
            onChange={(e) => set("additionalQualifications", e.target.value)}
            placeholder="Diploma in Aesthetic Medicine & Lasers"
            maxLength={1000}
            className={inputClass(!!errors.additionalQualifications)}
          />
        </Field>

        <Field
          label="Short Biography (Displayed in Portal Header/Summaries)"
          error={errors.shortBio}
          span2
        >
          <textarea
            value={values.shortBio}
            onChange={(e) => set("shortBio", e.target.value)}
            placeholder="Dr. Ayesha Rahman is a consultant dermatologist with over 10 years of clinical experience in diagnosing and managing skin, hair and nail conditions."
            rows={3}
            maxLength={1000}
            className={`${inputClass(!!errors.shortBio)} resize-y`}
          />
        </Field>

        <Field label="Full Biography / Profile Details" error={errors.fullBio} span2>
          <textarea
            value={values.fullBio}
            onChange={(e) => set("fullBio", e.target.value)}
            placeholder="Dr. Ayesha Rahman is a consultant dermatologist with over 10 years of clinical experience in diagnosing and managing a wide range of skin, hair and nail conditions. Her areas of professional interest include acne, pigmentation, hair disorders, inflammatory skin conditions and aesthetic dermatology."
            rows={6}
            maxLength={5000}
            className={`${inputClass(!!errors.fullBio)} resize-y`}
          />
        </Field>

        <Field
          label="Professional Interests (Comma Separated)"
          error={errors.professionalInterests}
          span2
        >
          <input
            type="text"
            value={values.professionalInterests}
            onChange={(e) => set("professionalInterests", e.target.value)}
            placeholder="Acne & Acne Scars, Hair & Scalp Disorders, Pigmentation & Melasma, Eczema & Psoriasis, Clinical Dermatology"
            maxLength={1000}
            className={inputClass(!!errors.professionalInterests)}
          />
        </Field>

        <Field label="Areas of Expertise (Comma Separated)" error={errors.areasOfExpertise} span2>
          <input
            type="text"
            value={values.areasOfExpertise}
            onChange={(e) => set("areasOfExpertise", e.target.value)}
            placeholder="Acne, Hair Loss, Pigmentation, Lasers, Eczema, Psoriasis"
            maxLength={1000}
            className={inputClass(!!errors.areasOfExpertise)}
          />
        </Field>
      </section>

      {/* 12–14. Contact details */}
      <section className="grid gap-4 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:grid-cols-3 md:p-6">
        <Field label="Phone Number" error={errors.phone}>
          <input
            type="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+92 300 1234567"
            maxLength={30}
            className={inputClass(!!errors.phone)}
          />
        </Field>

        <Field label="Email Address" error={errors.email}>
          <input
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="clinic@dermacare-demo.com"
            maxLength={255}
            className={inputClass(!!errors.email)}
          />
        </Field>

        <Field label="Languages Spoken" error={errors.languages}>
          <input
            type="text"
            value={values.languages}
            onChange={(e) => set("languages", e.target.value)}
            placeholder="English, Urdu"
            maxLength={255}
            className={inputClass(!!errors.languages)}
          />
        </Field>
      </section>

      {/* Consultation Schedule (shared section; schedule state lives with the page) */}
      <ConsultationScheduleFields
        values={schedule}
        errors={scheduleErrors}
        onChange={(key, value) => onScheduleChange(key, value)}
      />

      {topError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
          {topError}
        </p>
      )}

      {/* Save */}
      <div className="flex items-center justify-end gap-3 border-t border-[#E2E8F0] pt-5">
        <button
          type="submit"
          disabled={saving || resizing}
          className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
