"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  validateAppointment,
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  type AppointmentFieldErrors,
} from "@/lib/appointmentValidation";
import FormSelect from "@/components/dashboard/FormSelect";
import { authHeaders } from "@/lib/useAuthMe";

export type PatientOption = { id: string; fullName: string; patientId: string };
export type DoctorOption = { id: string; fullName: string; specialty: string | null };
export type ClinicOption = { id: string; clinicName: string; city: string | null };

export type AppointmentFormValues = {
  patientId: string;
  doctorId: string;
  clinicId: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  status: string;
};

export type AppointmentForEdit = {
  id: string;
  appointmentId?: string; // human-readable code (APT-YYYYMMDD-XXXX), shown read-only
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  appointmentType?: string;
  status?: string;
};

const EMPTY_FORM: AppointmentFormValues = {
  patientId: "",
  doctorId: "",
  clinicId: "",
  appointmentDate: "",
  appointmentTime: "",
  appointmentType: "",
  status: "scheduled",
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
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium tracking-wide text-[#5B6B7C]">
        {label}
        {required && <span className="ml-1 text-[#0369A1]">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

type Option = { id: string; primary: string; secondary: string };

/**
 * Searchable single-select combobox (keyboard friendly). Renders a button
 * that opens a filtered list; selecting fills a hidden relation id.
 */
function SearchableSelect({
  label,
  htmlFor,
  placeholder,
  options,
  value,
  onChange,
  error,
  disabled,
  loadingText,
  emptyText,
}: {
  label: string;
  htmlFor: string;
  placeholder: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  error?: string;
  disabled?: boolean;
  loadingText?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.primary.toLowerCase().includes(q) || o.secondary.toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <Field label={label} htmlFor={htmlFor} error={error} required>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          id={htmlFor}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
            setQuery("");
          }}
          className={`${inputClass(!!error)} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span className={selected ? "" : "text-[#83909D]"}>
            {selected ? selected.primary : (loadingText ?? placeholder)}
          </span>
          <ChevronDown size={16} className="shrink-0 text-[#83909D]" />
        </button>

        {open && (
          <div className="animate-dropdown-in absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-2xl shadow-black/10">
            <div className="relative border-b border-[#E2E8F0]">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#83909D]"
              />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full bg-[#F1F5F9] py-2.5 pl-9 pr-9 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#83909D] transition-colors hover:text-[#0369A1]"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="hide-scrollbar max-h-56 overflow-y-auto py-1.5">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[#83909D]">
                  {options.length === 0 ? (emptyText ?? "No options available.") : "No matches found."}
                </p>
              ) : (
                filtered.map((o) => {
                  const isSelected = o.id === value;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        onChange(o.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                        isSelected
                          ? "bg-[#0369A1]/10"
                          : "hover:bg-[#0369A1]/10"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium ${
                            isSelected ? "text-[#0369A1]" : "text-[#1E293B]"
                          }`}
                        >
                          {o.primary}
                        </span>
                        <span className="block truncate text-xs text-[#83909D]">{o.secondary}</span>
                      </span>
                      {isSelected && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0369A1]/15">
                          <Check size={12} className="text-[#0369A1]" />
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

export default function AppointmentForm({
  appointment,
  patients,
  doctors,
  clinics,
  patientsLoading,
  doctorsLoading,
  clinicsLoading,
  onSaved,
  onCancel,
}: {
  appointment: AppointmentForEdit | null;
  patients: PatientOption[];
  doctors: DoctorOption[];
  clinics: ClinicOption[];
  patientsLoading: boolean;
  doctorsLoading: boolean;
  clinicsLoading: boolean;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(appointment);
  const [values, setValues] = useState<AppointmentFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<AppointmentFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (appointment) {
      setValues({
        patientId: appointment.patientId ?? "",
        doctorId: appointment.doctorId ?? "",
        clinicId: appointment.clinicId ?? "",
        // DATE/TIME columns come back as ISO strings; slice keeps the raw
        // calendar date / 24h time without any timezone conversion.
        appointmentDate: (appointment.appointmentDate ?? "").slice(0, 10),
        appointmentTime: (appointment.appointmentTime ?? "").slice(0, 5),
        appointmentType: appointment.appointmentType ?? "",
        status: appointment.status ?? "scheduled",
      });
    } else {
      setValues(EMPTY_FORM);
    }
    setErrors({});
    setSubmitError("");
  }, [appointment]);

  const set = useCallback((name: keyof AppointmentFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev: AppointmentFieldErrors) =>
      prev[name] ? { ...prev, [name]: undefined } : prev
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // prevent duplicate submissions

    const result = validateAppointment(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    setSubmitError("");
    try {
      const res = await fetch(
        isEdit ? `/api/appointments/${appointment?.id}` : "/api/appointments",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(result.data),
        }
      );
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        data?: unknown;
      } | null;

      if (
        res.status === 400 &&
        json?.data &&
        typeof json.data === "object" &&
        "errors" in (json.data as object)
      ) {
        setErrors((json.data as { errors: AppointmentFieldErrors }).errors);
        setSubmitError(json.message ?? "Please fix the highlighted fields.");
        return;
      }
      if (!res.ok || !json?.success) {
        setSubmitError(json?.message ?? "Unable to save appointment.");
        return;
      }

      onSaved(
        isEdit ? "Appointment updated successfully." : "Appointment created successfully."
      );
    } catch {
      setSubmitError("Unable to save appointment. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const patientOptions: Option[] = useMemo(
    () =>
      patients.map((p) => ({
        id: p.id,
        primary: p.fullName,
        secondary: p.patientId,
      })),
    [patients]
  );
  const doctorOptions: Option[] = useMemo(
    () =>
      doctors.map((d) => ({
        id: d.id,
        primary: d.fullName,
        secondary: d.specialty ?? d.fullName,
      })),
    [doctors]
  );
  const clinicOptions: Option[] = useMemo(
    () =>
      clinics.map((c) => ({
        id: c.id,
        primary: c.clinicName,
        secondary: c.city ?? c.clinicName,
      })),
    [clinics]
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SearchableSelect
            label="Patient"
            htmlFor="a-patient"
            placeholder="Select patient"
            options={patientOptions}
            value={values.patientId}
            onChange={(id) => set("patientId", id)}
            error={errors.patientId}
            disabled={patientsLoading}
            loadingText={patientsLoading ? "Loading patients..." : "Select patient"}
            emptyText="No patients available. Add a patient first."
          />

          <SearchableSelect
            label="Doctor"
            htmlFor="a-doctor"
            placeholder="Select doctor"
            options={doctorOptions}
            value={values.doctorId}
            onChange={(id) => set("doctorId", id)}
            error={errors.doctorId}
            disabled={doctorsLoading}
            loadingText={doctorsLoading ? "Loading doctors..." : "Select doctor"}
            emptyText="No doctors available. Add a doctor first."
          />

          <SearchableSelect
            label="Clinic"
            htmlFor="a-clinic"
            placeholder="Select clinic"
            options={clinicOptions}
            value={values.clinicId}
            onChange={(id) => set("clinicId", id)}
            error={errors.clinicId}
            disabled={clinicsLoading}
            loadingText={clinicsLoading ? "Loading clinics..." : "Select clinic"}
            emptyText="No clinics available. Add a clinic first."
          />

          <Field
            label="Appointment Type"
            htmlFor="a-type"
            error={errors.appointmentType}
            required
          >
            <FormSelect
              id="a-type"
              value={values.appointmentType}
              onChange={(v) => set("appointmentType", v)}
              placeholder="Select type"
              hasError={!!errors.appointmentType}
              options={APPOINTMENT_TYPES.map((t) => ({
                value: t,
                label: APPOINTMENT_TYPE_LABELS[t],
              }))}
            />
          </Field>

          <Field label="Appointment Date" htmlFor="a-date" error={errors.appointmentDate} required>
            <input
              id="a-date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={values.appointmentDate}
              onChange={(e) => set("appointmentDate", e.target.value)}
              className={`${inputClass(!!errors.appointmentDate)} [color-scheme:light]`}
            />
          </Field>

          <Field label="Appointment Time" htmlFor="a-time" error={errors.appointmentTime} required>
            <input
              id="a-time"
              type="time"
              value={values.appointmentTime}
              onChange={(e) => set("appointmentTime", e.target.value)}
              className={`${inputClass(!!errors.appointmentTime)} [color-scheme:light]`}
            />
          </Field>

          <Field label="Status" htmlFor="a-status" error={errors.status} required>
            <FormSelect
              id="a-status"
              value={values.status || "scheduled"}
              onChange={(v) => set("status", v)}
              placeholder="Select status"
              hasError={!!errors.status}
              options={APPOINTMENT_STATUSES.map((s) => ({
                value: s,
                label: APPOINTMENT_STATUS_LABELS[s],
              }))}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Appointment ID (auto-generated)" htmlFor="a-id">
              <input
                id="a-id"
                type="text"
                value={appointment?.appointmentId ?? "Auto-generated on save"}
                readOnly
                disabled
                className={`${inputClass(false)} cursor-not-allowed opacity-60`}
              />
            </Field>
          </div>

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
          {saving
            ? isEdit
              ? "Saving changes..."
              : "Saving..."
            : isEdit
              ? "Save Changes"
              : "Save Appointment"}
        </button>
      </div>
    </form>
  );
}
