"use client";

import {
  CONSULTATION_DAYS,
  type ConsultationDay,
} from "@/lib/doctorValidation";

export type ScheduleValues = {
  consultationDays: ConsultationDay[];
  consultationStartTime: string;
  consultationEndTime: string;
};

export const EMPTY_SCHEDULE: ScheduleValues = {
  consultationDays: [],
  consultationStartTime: "",
  consultationEndTime: "",
};

type ScheduleErrors = Partial<Record<keyof ScheduleValues, string | undefined>>;

type ConsultationScheduleFieldsProps = {
  values: ScheduleValues;
  errors: ScheduleErrors;
  onChange: <K extends keyof ScheduleValues>(key: K, value: ScheduleValues[K]) => void;
};

const inputClass = (hasError: boolean) =>
  `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:ring-2 focus:ring-[#0369A1]/20 [color-scheme:light] ${
    hasError ? "border-red-400/60 focus:border-red-400" : "border-[#E2E8F0] focus:border-[#0369A1]"
  }`;

/**
 * Consultation Schedule section (shared by the doctor form and the detailed
 * profile form). Fully controlled — the parent owns the values so a fresh
 * mount always starts from EMPTY_SCHEDULE (no stale data between doctors).
 */
export default function ConsultationScheduleFields({
  values,
  errors,
  onChange,
}: ConsultationScheduleFieldsProps) {
  function toggleDay(day: ConsultationDay) {
    const selected = values.consultationDays.includes(day)
      ? values.consultationDays.filter((d) => d !== day)
      : [...values.consultationDays, day];
    // Keep DB order consistent (Monday..Sunday).
    onChange(
      "consultationDays",
      CONSULTATION_DAYS.filter((d) => selected.includes(d))
    );
  }

  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
      <h2 className="text-sm font-semibold text-slate-900">Consultation Schedule</h2>
      <p className="mt-1 text-xs text-[#83909D]">
        Optional — define when this doctor sees patients.
      </p>

      {/* Consultation days */}
      <div className="mt-5">
        <p className="mb-2 text-sm font-medium text-[#5B6B7C]">Consultation Days</p>
        <div className="flex flex-wrap gap-2">
          {CONSULTATION_DAYS.map((day) => {
            const selected = values.consultationDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={selected}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? "border-[#0369A1] bg-[#0369A1]/15 text-[#0369A1]"
                    : "border-[#E2E8F0] bg-[#F1F5F9] text-[#5B6B7C] hover:border-[#83909D] hover:text-slate-900"
                }`}
              >
                {day.slice(0, 3)}
              </button>
            );
          })}
        </div>
        {errors.consultationDays && <p className="mt-1.5 text-xs text-red-600">{errors.consultationDays}</p>}
      </div>

      {/* Hours */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="consult-start" className="mb-1.5 block text-sm font-medium text-[#5B6B7C]">
            Consultation Start Time
          </label>
          <input
            id="consult-start"
            type="time"
            value={values.consultationStartTime}
            onChange={(e) => onChange("consultationStartTime", e.target.value)}
            className={inputClass(!!errors.consultationStartTime)}
          />
          {errors.consultationStartTime && (
            <p className="mt-1 text-xs text-red-600">{errors.consultationStartTime}</p>
          )}
        </div>

        <div>
          <label htmlFor="consult-end" className="mb-1.5 block text-sm font-medium text-[#5B6B7C]">
            Consultation End Time
          </label>
          <input
            id="consult-end"
            type="time"
            value={values.consultationEndTime}
            onChange={(e) => onChange("consultationEndTime", e.target.value)}
            className={inputClass(!!errors.consultationEndTime)}
          />
          {errors.consultationEndTime && (
            <p className="mt-1 text-xs text-red-600">{errors.consultationEndTime}</p>
          )}
        </div>
      </div>
    </section>
  );
}
