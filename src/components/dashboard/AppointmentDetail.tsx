"use client";

import { useEffect, useState } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointmentValidation";
import { authHeaders } from "@/lib/useAuthMe";

export type AppointmentRecord = {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  patientName: string;
  patientCode: string;
  patientPhone: string | null;
  doctorName: string;
  doctorTitle: string | null;
  doctorSpecialty: string | null;
  clinicName: string;
  clinicCity: string | null;
};

/**
 * Maps the camelCase appointment object returned by GET /api/appointments
 * (and /api/appointments/[id]) to the AppointmentRecord shape used by the UI.
 * The API already JOINs the display data into nested objects:
 *   patient: { fullName, patientId, phone }
 *   doctor:  { fullName, professionalTitle, specialty }
 *   clinic:  { clinicName, city, ... }
 */
export function mapApiAppointment(row: Record<string, unknown>): AppointmentRecord {
  const str = (key: string) =>
    typeof row[key] === "string" ? (row[key] as string) : null;
  const obj = (key: string): Record<string, unknown> =>
    typeof row[key] === "object" && row[key] !== null
      ? (row[key] as Record<string, unknown>)
      : {};
  const nested = (parent: Record<string, unknown>, key: string) =>
    typeof parent[key] === "string" ? (parent[key] as string) : null;
  const patient = obj("patient");
  const doctor = obj("doctor");
  const clinic = obj("clinic");
  return {
    id: String(row.id ?? ""),
    appointmentId: str("appointmentId") ?? "",
    patientId: str("patientId") ?? "",
    doctorId: str("doctorId") ?? "",
    clinicId: str("clinicId") ?? "",
    appointmentDate: str("appointmentDate") ?? "",
    appointmentTime: str("appointmentTime") ?? "",
    appointmentType: str("appointmentType") ?? "",
    status: str("status") ?? "scheduled",
    createdAt: str("createdAt") ?? "",
    updatedAt: str("updatedAt") ?? "",
    patientName: nested(patient, "fullName") ?? "",
    patientCode: nested(patient, "patientId") ?? "",
    patientPhone: nested(patient, "phone"),
    doctorName: nested(doctor, "fullName") ?? "",
    doctorTitle: nested(doctor, "professionalTitle"),
    doctorSpecialty: nested(doctor, "specialty"),
    clinicName: nested(clinic, "clinicName") ?? "",
    clinicCity: nested(clinic, "city"),
  };
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-[#83909D]">{label}</span>
      <span className="text-sm text-[#1E293B]">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#0369A1]">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  const parts = (value ?? "").split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (parts.length < 2 || Number.isNaN(h) || Number.isNaN(m)) return "—";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDate(value: string): string {
  // Keep the stored calendar date — no timezone conversion.
  const [y, m, d] = (value ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value ? value : "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const statusChip = (status: string) => {
  const s = status.toLowerCase();
  if (s === "scheduled") return "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30";
  if (s === "confirmed") return "bg-sky-500/15 text-sky-700 border-sky-600/30";
  if (s === "completed") return "bg-sky-600/15 text-sky-700 border-sky-600/30";
  if (s === "cancelled") return "bg-red-500/15 text-red-700 border-red-500/30";
  return "bg-amber-500/15 text-amber-700 border-amber-500/30";
};

const statusLabel = (status: string) =>
  APPOINTMENT_STATUS_LABELS[status as AppointmentStatus] ?? status;

const typeLabel = (type: string) =>
  APPOINTMENT_TYPE_LABELS[type as AppointmentType] ?? type;

export default function AppointmentDetail({
  appointmentId,
  onClose,
  onEdit,
}: {
  appointmentId: string;
  onClose: () => void;
  onEdit: (appointment: AppointmentRecord) => void;
}) {
  const [appointment, setAppointment] = useState<AppointmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/appointments/${appointmentId}`, { headers: authHeaders() })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: Record<string, unknown>;
          message?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok || !json?.success || !json.data) {
          setError(json?.message ?? "Unable to load appointment.");
          return;
        }
        setAppointment(mapApiAppointment(json.data));
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load appointment. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-4xl rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] p-6">
          <div>
            <h2 className="text-lg font-semibold text-[#1E293B]">
              {appointment ? appointment.appointmentId : "Appointment Details"}
            </h2>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              {loading
                ? "Loading appointment..."
                : appointment
                  ? `${appointment.patientName} · ${formatDate(appointment.appointmentDate)} at ${formatTime(appointment.appointmentTime)}`
                  : "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-6">
          {loading && (
            <div className="py-10 text-center text-sm text-[#5B6B7C]">Loading appointment...</div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-400/10 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && appointment && (
            <>
              <Section title="Patient Information">
                <Detail label="Name" value={appointment.patientName} />
                <Detail label="Patient ID" value={appointment.patientCode} />
                <Detail label="Phone" value={appointment.patientPhone ?? "—"} />
              </Section>

              <Section title="Doctor Information">
                <Detail label="Name" value={appointment.doctorName} />
                <Detail label="Professional Title" value={appointment.doctorTitle ?? "—"} />
                <Detail label="Specialty" value={appointment.doctorSpecialty ?? "—"} />
              </Section>

              <Section title="Clinic Information">
                <Detail label="Clinic Name" value={appointment.clinicName} />
                <Detail label="City" value={appointment.clinicCity ?? "—"} />
              </Section>

              <Section title="Appointment Information">
                <Detail label="Appointment ID" value={appointment.appointmentId} />
                <Detail label="Date" value={formatDate(appointment.appointmentDate)} />
                <Detail label="Time" value={formatTime(appointment.appointmentTime)} />
                <Detail label="Type" value={typeLabel(appointment.appointmentType)} />
                <Detail
                  label="Status"
                  value={
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChip(
                        appointment.status
                      )}`}
                    >
                      {statusLabel(appointment.status)}
                    </span>
                  }
                />
                <Detail label="Created Date" value={formatTimestamp(appointment.createdAt)} />
                <Detail label="Updated Date" value={formatTimestamp(appointment.updatedAt)} />
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        {appointment && (
          <div className="flex justify-end gap-3 border-t border-[#E2E8F0] p-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[#E2E8F0] px-5 py-2.5 text-sm font-medium text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => onEdit(appointment)}
              className="rounded-xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985]"
            >
              Edit Appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
