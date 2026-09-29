"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  validateDoctor,
  CONSULTATION_DAYS,
  type DoctorFieldErrors,
  type ConsultationDay,
} from "@/lib/doctorValidation";
import ConsultationScheduleFields, {
  EMPTY_SCHEDULE,
  type ScheduleValues,
} from "@/components/dashboard/ConsultationScheduleFields";
import FormSelect from "@/components/dashboard/FormSelect";

export type DoctorFormValues = {
  fullName: string;
  specialty: string;
  professionalTitle: string;
  status: string;
  schedule: ScheduleValues;
};

export type DoctorOption = {
  id: string;
  fullName: string;
  specialty: string | null;
};

/** Fresh form state — used for Add Doctor and whenever the form must reset. */
export const EMPTY_DOCTOR_FORM: DoctorFormValues = {
  fullName: "",
  specialty: "",
  professionalTitle: "",
  status: "active",
  schedule: EMPTY_SCHEDULE,
};

type DoctorFormProps = {
  initial?: DoctorFormValues | null;
  saving: boolean;
  onSave: (values: DoctorFormValues) => void;
  onCancel: () => void;
};

const inputClass = (hasError: boolean) =>
  `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:ring-2 focus:ring-[#0369A1]/20 ${
    hasError ? "border-red-400/60 focus:border-red-400" : "border-[#E2E8F0] focus:border-[#0369A1]"
  }`;

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-[#5B6B7C]">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function DoctorForm({ initial, saving, onSave, onCancel }: DoctorFormProps) {
  const [values, setValues] = useState<DoctorFormValues>(initial ?? EMPTY_DOCTOR_FORM);
  const [errors, setErrors] = useState<DoctorFieldErrors>({});

  // Reset whenever the parent switches the form's identity (Add <-> Edit A <-> Edit B).
  useEffect(() => {
    setValues(initial ?? EMPTY_DOCTOR_FORM);
    setErrors({});
  }, [initial]);

  function set<K extends keyof DoctorFormValues>(key: K, value: DoctorFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev } as Record<string, string | undefined>;
      delete next[key as string];
      return next as DoctorFieldErrors;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateDoctor({
      fullName: values.fullName,
      specialty: values.specialty,
      professionalTitle: values.professionalTitle,
      status: values.status,
      consultationDays: values.schedule.consultationDays,
      consultationStartTime: values.schedule.consultationStartTime,
      consultationEndTime: values.schedule.consultationEndTime,
    });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    onSave(values);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Doctor Name" htmlFor="doctor-name" error={errors.fullName}>
          <input
            id="doctor-name"
            type="text"
            value={values.fullName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("fullName", e.target.value)}
            placeholder="Dr. Ayesha Rahman"
            className={inputClass(!!errors.fullName)}
          />
        </Field>

        <Field label="Specialty" htmlFor="doctor-specialty" error={errors.specialty}>
          <input
            id="doctor-specialty"
            type="text"
            value={values.specialty}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("specialty", e.target.value)}
            placeholder="Dermatologist"
            className={inputClass(!!errors.specialty)}
          />
        </Field>

        <Field label="Professional Title" htmlFor="doctor-title" error={errors.professionalTitle}>
          <input
            id="doctor-title"
            type="text"
            value={values.professionalTitle}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("professionalTitle", e.target.value)}
            placeholder="Consultant Dermatologist"
            className={inputClass(!!errors.professionalTitle)}
          />
        </Field>

        <Field label="Status" htmlFor="doctor-status" error={errors.status}>
          <FormSelect
            id="doctor-status"
            value={values.status}
            onChange={(v) => set("status", v)}
            placeholder="Select status"
            hasError={!!errors.status}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </Field>
      </div>

      {/* Consultation Schedule */}
      <div className="mt-5">
        <ConsultationScheduleFields
          values={values.schedule}
          errors={errors as Partial<Record<keyof ScheduleValues, string | undefined>>}
          onChange={(key, value) =>
            setValues((prev) => ({
              ...prev,
              schedule: { ...prev.schedule, [key]: value },
            }))
          }
        />
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Doctor"}
        </button>
      </div>
    </form>
  );
}
