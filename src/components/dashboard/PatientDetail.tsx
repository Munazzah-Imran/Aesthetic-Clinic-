"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/useAuthMe";

export type PatientRecord = {
  id: string;
  patientId: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  age: number | string | null;
  maritalStatus: string | null;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  fullAddress: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

/** Maps a raw snake_case API row to the camelCase PatientRecord shape. */
function mapApiPatient(row: Record<string, unknown>): PatientRecord {
  const str = (key: string) =>
    typeof row[key] === "string" ? (row[key] as string) : null;
  return {
    id: String(row.id ?? ""),
    patientId: String(row.patient_id ?? ""),
    fullName: String(row.full_name ?? ""),
    gender: str("gender"),
    dateOfBirth: str("date_of_birth"),
    age:
      typeof row.age === "number"
        ? row.age
        : typeof row.age === "string" && row.age !== ""
          ? Number(row.age)
          : null,
    maritalStatus: str("marital_status"),
    phone: str("phone"),
    alternatePhone: str("alternate_phone"),
    email: str("email"),
    fullAddress: str("full_address"),
    city: str("city"),
    emergencyContactName: str("emergency_contact_name"),
    emergencyContactRelationship: str("emergency_contact_relationship"),
    emergencyContactPhone: str("emergency_contact_phone"),
    status: String(row.status ?? "active"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#0369A1]">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? `${age} years` : "—";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Show the stored age; fall back to computing it from DOB. */
function displayAge(patient: PatientRecord): string {
  if (patient.age !== null && patient.age !== undefined && String(patient.age) !== "") {
    return `${patient.age} years`;
  }
  return calcAge(patient.dateOfBirth);
}

const statusChip = (status: string) => {
  const s = status.toLowerCase();
  if (s === "active")
    return "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30";
  if (s === "inactive")
    return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-[#E2E8F0]/60 text-[#5B6B7C] border-[#E2E8F0]";
};

export default function PatientDetail({
  patientId,
  onClose,
  onEdit,
}: {
  patientId: string;
  onClose: () => void;
  onEdit: (patient: PatientRecord) => void;
}) {
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/patients/${patientId}`, { headers: authHeaders() })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: Record<string, unknown>;
          message?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok || !json?.success || !json.data) {
          setError(json?.message ?? "Unable to load patient.");
          return;
        }
        setPatient(mapApiPatient(json.data));
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load patient. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const label = (s: string) => {
    const v = s.toLowerCase();
    if (v === "active") return "Active";
    if (v === "inactive") return "Inactive";
    return "Archived";
  };

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
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0369A1]/15 text-lg font-semibold text-[#0369A1]">
              {initialsOf(patient?.fullName ?? "")}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B]">
                {patient?.fullName ?? "Patient Profile"}
              </h2>
              <p className="text-sm text-[#5B6B7C]">
                {patient?.patientId ? `Patient ID: ${patient.patientId}` : "Loading patient..."}
              </p>
            </div>
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
            <div className="py-10 text-center text-sm text-[#5B6B7C]">Loading patient...</div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-400/10 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && patient && (
            <>
              <Section title="Personal Information">
                <Detail label="Patient ID" value={patient.patientId} />
                <Detail label="Full Name" value={patient.fullName} />
                <Detail label="Gender" value={patient.gender ?? "—"} />
                <Detail label="Age" value={displayAge(patient)} />
                <Detail label="Date of Birth" value={formatDate(patient.dateOfBirth)} />
                <Detail label="Marital Status" value={patient.maritalStatus ?? "—"} />
              </Section>

              <Section title="Contact Information">
                <Detail label="Phone" value={patient.phone ?? "—"} />
                <Detail label="Alternate Phone" value={patient.alternatePhone ?? "—"} />
                <Detail label="Email" value={patient.email ?? "—"} />
                <div className="sm:col-span-2 lg:col-span-3">
                  <Detail label="Address" value={patient.fullAddress ?? "—"} />
                </div>
                <Detail label="City" value={patient.city ?? "—"} />
              </Section>

              <Section title="Emergency Contact">
                <Detail label="Name" value={patient.emergencyContactName ?? "—"} />
                <Detail label="Relationship" value={patient.emergencyContactRelationship ?? "—"} />
                <Detail label="Phone" value={patient.emergencyContactPhone ?? "—"} />
              </Section>

              <Section title="Account Information">
                <Detail
                  label="Status"
                  value={
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChip(
                        patient.status
                      )}`}
                    >
                      {label(patient.status)}
                    </span>
                  }
                />
                <Detail label="Registration Date" value={formatDate(patient.createdAt)} />
                <Detail label="Updated Date" value={formatDate(patient.updatedAt)} />
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        {patient && (
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
              onClick={() => onEdit(patient)}
              className="rounded-xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985]"
            >
              Edit Patient
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
