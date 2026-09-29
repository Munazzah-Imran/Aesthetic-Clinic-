"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  validatePatient,
  calculateAge,
  type PatientFieldErrors,
} from "@/lib/patientValidation";
import FormSelect from "@/components/dashboard/FormSelect";
import { authHeaders } from "@/lib/useAuthMe";

type PatientApi = {
  id: string;
  patientId?: string;
  fullName?: string;
  gender?: string | null;
  dateOfBirth?: string | null;
  age?: number | string | null;
  maritalStatus?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  fullAddress?: string | null;
  city?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  status?: string | null;
};

type PatientFormValues = {
  [K in keyof PatientFieldErrors]-?: string;
};

const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Prefer not to say"];
const GENDERS = ["Male", "Female", "Other"];

const EMPTY_FORM: PatientFormValues = {
  fullName: "",
  gender: "",
  age: "",
  dateOfBirth: "",
  maritalStatus: "",
  phone: "",
  alternatePhone: "",
  email: "",
  fullAddress: "",
  city: "",
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
  status: "active",
};

const inputClass = (hasError: boolean) =>
  `w-full rounded-xl bg-[#F1F5F9] border ${
    hasError ? "border-red-400/70" : "border-[#E2E8F0]"
  } px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20`;

function Field({
  label,
  htmlFor,
  error,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium tracking-wide text-[#5B6B7C]">
        {label}
        {required && <span className="ml-1 text-[#0369A1]">*</span>}
        {optional && (
          <span className="ml-1.5 text-[10px] font-normal normal-case text-[#83909D]">
            (optional)
          </span>
        )}
        {hint && (
          <span className="ml-1.5 text-[10px] font-normal normal-case text-[#83909D]">
            {hint}
          </span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const labelOf = (status: string) => {
  const s = status.toLowerCase();
  if (s === "active") return "Active";
  if (s === "inactive") return "Inactive";
  return "Archived";
};

export default function PatientForm({
  patient,
  onSaved,
  onCancel,
}: {
  patient: PatientApi | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(patient);
  const [values, setValues] = useState<PatientFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<PatientFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (patient) {
      setValues({
        fullName: patient.fullName ?? "",
        gender: patient.gender ?? "",
        age: patient.age !== null && patient.age !== undefined ? String(patient.age) : "",
        dateOfBirth: patient.dateOfBirth ?? "",
        maritalStatus: patient.maritalStatus ?? "",
        phone: patient.phone ?? "",
        alternatePhone: patient.alternatePhone ?? "",
        email: patient.email ?? "",
        fullAddress: patient.fullAddress ?? "",
        city: patient.city ?? "",
        emergencyContactName: patient.emergencyContactName ?? "",
        emergencyContactRelationship: patient.emergencyContactRelationship ?? "",
        emergencyContactPhone: patient.emergencyContactPhone ?? "",
        status: labelOf(patient.status ?? "active").toLowerCase(),
      });
    } else {
      setValues(EMPTY_FORM);
    }
    setErrors({});
    setSubmitError("");
  }, [patient]);

  const set = useCallback((name: keyof PatientFormValues, value: string) => {
    setValues((prev: PatientFormValues) => ({ ...prev, [name]: value }));
    setErrors((prev: PatientFieldErrors) =>
      prev[name] ? { ...prev, [name]: undefined } : prev
    );
  }, []);

  /**
   * Age stays synchronized with Date of Birth: the Age field is read-only and
   * shows the age computed from the selected DOB (single source of truth, no
   * conflicting duplicate age logic).
   */
  const derivedAge = useMemo(
    () => (values.dateOfBirth ? calculateAge(values.dateOfBirth) : null),
    [values.dateOfBirth]
  );
  useEffect(() => {
    const next = derivedAge !== null ? String(derivedAge) : "";
    setValues((prev) => (prev.age === next ? prev : { ...prev, age: next }));
  }, [derivedAge]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // prevent duplicate submissions

    const result = validatePatient(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    setSubmitError("");
    try {
      const res = await fetch(isEdit ? `/api/patients/${patient?.id}` : "/api/patients", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(result.data),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        data?: unknown;
      } | null;

      if (res.status === 400 && json?.data && typeof json.data === "object" && "errors" in (json.data as object)) {
        setErrors((json.data as { errors: PatientFieldErrors }).errors);
        setSubmitError(json.message ?? "Please fix the highlighted fields.");
        return;
      }
      if (!res.ok || !json?.success) {
        setSubmitError(json?.message ?? "Unable to save patient.");
        return;
      }

      onSaved(isEdit ? "Patient updated successfully." : "Patient created successfully.");
    } catch {
      setSubmitError("Unable to save patient. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const statusValue = useMemo(() => values.status || "active", [values.status]);

  /** Local (not UTC) today string so the DOB picker never blocks today's date. */
  const todayLocal = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
      t.getDate()
    ).padStart(2, "0")}`;
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {/* Basic Information */}
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#0369A1]">
          Basic Information
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full Name" htmlFor="p-name" error={errors.fullName} required>
            <input
              id="p-name"
              type="text"
              value={values.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              placeholder="Muhammad Ahmed"
              className={inputClass(!!errors.fullName)}
            />
          </Field>

          <Field
            label="Patient ID (auto-generated)"
            htmlFor="p-patient-id"
          >
            <input
              id="p-patient-id"
              type="text"
              value={patient?.patientId ?? "Auto-generated on save"}
              readOnly
              disabled
              className={`${inputClass(false)} cursor-not-allowed opacity-60`}
            />
          </Field>

          <Field label="Gender" htmlFor="p-gender" error={errors.gender} required>
            <FormSelect
              id="p-gender"
              value={values.gender}
              onChange={(v) => set("gender", v)}
              placeholder="Select gender"
              hasError={!!errors.gender}
              options={GENDERS.map((g) => ({ value: g, label: g }))}
            />
          </Field>

          <Field
            label="Age"
            htmlFor="p-age"
            error={errors.age}
            required
            hint="(auto from DOB)"
          >
            <input
              id="p-age"
              type="text"
              inputMode="numeric"
              value={values.age}
              placeholder="Auto"
              readOnly
              title="Age is calculated automatically from the selected Date of Birth."
              className={`${inputClass(!!errors.age)} cursor-not-allowed opacity-60`}
            />
          </Field>

          <Field label="Date of Birth" htmlFor="p-dob" error={errors.dateOfBirth} required>
            <input
              id="p-dob"
              type="date"
              value={values.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
              max={todayLocal}
              className={`${inputClass(!!errors.dateOfBirth)} [color-scheme:light]`}
            />
          </Field>

          <Field label="Marital Status" htmlFor="p-marital" error={errors.maritalStatus} required>
            <FormSelect
              id="p-marital"
              value={values.maritalStatus}
              onChange={(v) => set("maritalStatus", v)}
              placeholder="Select marital status"
              hasError={!!errors.maritalStatus}
              options={MARITAL_STATUSES.map((m) => ({ value: m, label: m }))}
            />
          </Field>
        </div>
      </section>

      {/* Contact Information */}
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#0369A1]">
          Contact Information
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Contact Number" htmlFor="p-phone" error={errors.phone} required>
            <input
              id="p-phone"
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+92 300 1234567"
              className={inputClass(!!errors.phone)}
            />
          </Field>

          <Field label="Alternate Phone" htmlFor="p-alt-phone" error={errors.alternatePhone} optional>
            <input
              id="p-alt-phone"
              type="tel"
              value={values.alternatePhone}
              onChange={(e) => set("alternatePhone", e.target.value)}
              placeholder="+92 301 7654321"
              className={inputClass(!!errors.alternatePhone)}
            />
          </Field>

          <Field label="Email Address" htmlFor="p-email" error={errors.email} optional>
            <input
              id="p-email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="patient@example.com"
              className={inputClass(!!errors.email)}
            />
          </Field>

          <Field label="City" htmlFor="p-city" error={errors.city} required>
            <input
              id="p-city"
              type="text"
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Karachi"
              className={inputClass(!!errors.city)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Full Address" htmlFor="p-address" error={errors.fullAddress} optional>
              <textarea
                id="p-address"
                rows={2}
                value={values.fullAddress}
                onChange={(e) => set("fullAddress", e.target.value)}
                placeholder="House 123, Block 5, Gulshan-e-Iqbal, Karachi"
                className={`${inputClass(!!errors.fullAddress)} resize-y`}
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Emergency Contact */}
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#0369A1]">
          Emergency Contact
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Emergency Contact Name"
            htmlFor="p-ec-name"
            error={errors.emergencyContactName}
            optional
          >
            <input
              id="p-ec-name"
              type="text"
              value={values.emergencyContactName}
              onChange={(e) => set("emergencyContactName", e.target.value)}
              placeholder="Ahmed Khan"
              className={inputClass(!!errors.emergencyContactName)}
            />
          </Field>

          <Field
            label="Relationship"
            htmlFor="p-ec-rel"
            error={errors.emergencyContactRelationship}
            optional
          >
            <input
              id="p-ec-rel"
              type="text"
              value={values.emergencyContactRelationship}
              onChange={(e) => set("emergencyContactRelationship", e.target.value)}
              placeholder="Brother"
              className={inputClass(!!errors.emergencyContactRelationship)}
            />
          </Field>

          <Field
            label="Emergency Contact Phone"
            htmlFor="p-ec-phone"
            error={errors.emergencyContactPhone}
            optional
          >
            <input
              id="p-ec-phone"
              type="tel"
              value={values.emergencyContactPhone}
              onChange={(e) => set("emergencyContactPhone", e.target.value)}
              placeholder="+92 300 1234567"
              className={inputClass(!!errors.emergencyContactPhone)}
            />
          </Field>
        </div>
      </section>

      {/* Account status — kept (existing behavior), never user-required */}
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="p-status" error={errors.status} optional>
            <FormSelect
              id="p-status"
              value={statusValue}
              onChange={(v) => set("status", v)}
              placeholder="Select status"
              hasError={!!errors.status}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Field>
        </div>
      </section>

      {submitError && (
        <div className="rounded-xl border border-red-500/30 bg-red-400/10 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-[#E2E8F0] bg-transparent px-5 py-2.5 text-sm font-medium text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[#0369A1] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Patient"}
        </button>
      </div>
    </form>
  );
}
