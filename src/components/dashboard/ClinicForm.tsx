"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  WORKING_DAYS,
  validateClinic,
  type ClinicFieldErrors,
} from "@/lib/clinicValidation";
import type { Clinic } from "@/components/dashboard/ClinicCard";
import FormSelect from "@/components/dashboard/FormSelect";

export type ClinicFormValues = {
  clinicName: string;
  city: string;
  cityCode: string;
  contactNumber: string;
  fullClinicAddress: string;
  workingDays: string[];
  openingTime: string;
  closingTime: string;
  status: string;
  googleMapUrl: string;
  latitude: string;
  longitude: string;
};

const EMPTY_FORM: ClinicFormValues = {
  clinicName: "",
  city: "",
  cityCode: "",
  contactNumber: "",
  fullClinicAddress: "",
  workingDays: [],
  openingTime: "",
  closingTime: "",
  status: "active",
  googleMapUrl: "",
  latitude: "",
  longitude: "",
};

type ClinicFormProps = {
  open: boolean;
  /** Clinic to edit, or null to create a new one. */
  clinic: Clinic | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Sends the request; returns an error message or null on success. */
  submit: (values: ClinicFormValues) => Promise<string | null>;
};

/**
 * NOTE: This component MUST stay defined outside ClinicForm. Defining it
 * inline would give it a new identity on every render, causing React to
 * unmount/remount its subtree — inputs would lose focus after each keystroke.
 */
function Field({
  label,
  error,
  children,
  span2 = false,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function ClinicForm({ open, clinic, onClose, onSaved, submit }: ClinicFormProps) {
  const [values, setValues] = useState<ClinicFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<ClinicFieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Populate the form when editing, reset when adding.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTopError(null);
    if (clinic) {
      setValues({
        clinicName: clinic.clinic_name,
        city: clinic.city,
        cityCode: clinic.city_code,
        contactNumber: clinic.contact_number,
        fullClinicAddress: clinic.full_clinic_address,
        workingDays: clinic.working_days.split(",").filter(Boolean),
        openingTime: clinic.opening_time?.slice(0, 5) ?? "",
        closingTime: clinic.closing_time?.slice(0, 5) ?? "",
        status: clinic.status,
        googleMapUrl: clinic.google_map_url ?? "",
        latitude: clinic.latitude ?? "",
        longitude: clinic.longitude ?? "",
      });
    } else {
      setValues(EMPTY_FORM);
    }
  }, [open, clinic]);

  if (!open) return null;

  function set<K extends keyof ClinicFormValues>(key: K, value: ClinicFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function toggleDay(day: string) {
    setValues((v) => ({
      ...v,
      workingDays: v.workingDays.includes(day)
        ? v.workingDays.filter((d) => d !== day)
        : [...v.workingDays, day],
    }));
    setErrors((e) => ({ ...e, workingDays: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // prevent duplicate submission

    // Client-side validation using the SHARED rules (same as backend).
    const result = validateClinic({
      clinicName: values.clinicName,
      city: values.city,
      cityCode: values.cityCode,
      contactNumber: values.contactNumber,
      fullClinicAddress: values.fullClinicAddress,
      workingDays: values.workingDays,
      openingTime: values.openingTime,
      closingTime: values.closingTime,
      status: values.status,
      googleMapUrl: values.googleMapUrl,
      latitude: values.latitude,
      longitude: values.longitude,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    setTopError(null);
    const errorMessage = await submit(values);
    setSaving(false);

    if (errorMessage) {
      setTopError(errorMessage);
      return;
    }
    onSaved("Clinic added successfully.");
  }

  const inputClass = (hasError: boolean) =>
    `h-10 w-full rounded-xl border bg-[#F1F5F9] px-3 text-sm text-slate-900 placeholder-[#83909D] outline-none transition-colors ${
      hasError
        ? "border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
        : "border-[#E2E8F0] focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/15"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-[#E2E8F0] bg-[#FFFFFF] px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {clinic ? "Edit Clinic Location" : "Add New Clinic Location"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#5B6B7C] hover:bg-sky-500/10 hover:text-sky-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic Name" error={errors.clinicName}>
              <input
                type="text"
                value={values.clinicName}
                onChange={(e) => set("clinicName", e.target.value)}
                placeholder="e.g. Ali Beauty Clinic"
                maxLength={255}
                className={inputClass(!!errors.clinicName)}
              />
            </Field>

            <Field label="City" error={errors.city}>
              <input
                type="text"
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="e.g. Karachi"
                maxLength={100}
                className={inputClass(!!errors.city)}
              />
            </Field>

            <Field label="City Code" error={errors.cityCode}>
              <input
                type="text"
                value={values.cityCode}
                onChange={(e) => set("cityCode", e.target.value.toUpperCase())}
                placeholder="e.g. KHI-01"
                maxLength={50}
                className={`${inputClass(!!errors.cityCode)} font-mono`}
              />
            </Field>

            <Field label="Contact Number" error={errors.contactNumber}>
              <input
                type="tel"
                value={values.contactNumber}
                onChange={(e) => set("contactNumber", e.target.value)}
                placeholder="e.g. +92 300 1234567"
                maxLength={30}
                className={inputClass(!!errors.contactNumber)}
              />
            </Field>

            <Field label="Full Clinic Address" error={errors.fullClinicAddress} span2>
              <textarea
                value={values.fullClinicAddress}
                onChange={(e) => set("fullClinicAddress", e.target.value)}
                placeholder="e.g. Main University Road, Gulshan-e-Iqbal, Karachi"
                rows={2}
                maxLength={500}
                className={`${inputClass(!!errors.fullClinicAddress)} h-auto py-2.5`}
              />
            </Field>

            {/* Working days */}
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">
                Working Days
              </label>
              <div className="flex flex-wrap gap-2">
                {WORKING_DAYS.map((day) => {
                  const selected = values.workingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "border-sky-500 bg-sky-500 text-white"
                          : "border-[#E2E8F0] bg-[#F1F5F9] text-[#5B6B7C] hover:border-sky-500/40 hover:text-sky-600"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              {errors.workingDays && (
                <p className="mt-1 text-xs text-red-600">{errors.workingDays}</p>
              )}
            </div>

            <Field label="Status" error={errors.status}>
              <FormSelect
                value={values.status}
                onChange={(v) => set("status", v)}
                placeholder="Select status"
                hasError={!!errors.status}
                options={[
                  { value: "active", label: "Active" },
                  { value: "coming_soon", label: "Coming Soon" },
                  { value: "inactive", label: "Inactive" },
                ]}
              />
            </Field>

            <Field label="Opening Time (optional)" error={errors.openingTime}>
              <input
                type="time"
                value={values.openingTime}
                onChange={(e) => set("openingTime", e.target.value)}
                className={`${inputClass(!!errors.openingTime)} [color-scheme:light]`}
              />
            </Field>

            <Field label="Closing Time (optional)" error={errors.closingTime}>
              <input
                type="time"
                value={values.closingTime}
                onChange={(e) => set("closingTime", e.target.value)}
                className={`${inputClass(!!errors.closingTime)} [color-scheme:light]`}
              />
            </Field>

            <Field label="Google Map URL (optional)" error={errors.googleMapUrl}>
              <input
                type="url"
                value={values.googleMapUrl}
                onChange={(e) => set("googleMapUrl", e.target.value)}
                placeholder="https://maps.google.com/..."
                className={inputClass(!!errors.googleMapUrl)}
              />
            </Field>

            <Field label="Latitude (optional)" error={errors.latitude}>
              <input
                type="text"
                inputMode="decimal"
                value={values.latitude}
                onChange={(e) => set("latitude", e.target.value)}
                placeholder="e.g. 24.8607"
                className={inputClass(!!errors.latitude)}
              />
            </Field>

            <Field label="Longitude (optional)" error={errors.longitude}>
              <input
                type="text"
                inputMode="decimal"
                value={values.longitude}
                onChange={(e) => set("longitude", e.target.value)}
                placeholder="e.g. 67.0011"
                className={inputClass(!!errors.longitude)}
              />
            </Field>
          </div>

          {topError && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
              {topError}
            </p>
          )}

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3 border-t border-[#E2E8F0] pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-5 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Clinic"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
