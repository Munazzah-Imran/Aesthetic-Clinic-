"use client";

import { Building2, MapPin, Pencil, Phone, Trash2, Map } from "lucide-react";
import { WORKING_DAYS } from "@/lib/clinicValidation";

export type Clinic = {
  id: string;
  clinic_name: string;
  city: string;
  city_code: string;
  contact_number: string;
  full_clinic_address: string;
  working_days: string;
  opening_time: string | null;
  closing_time: string | null;
  status: string;
  google_map_url: string | null;
  latitude: string | null;
  longitude: string | null;
};

type ClinicCardProps = {
  clinic: Clinic;
  onEdit: (clinic: Clinic) => void;
  onDelete: (clinic: Clinic) => void;
};

export const STATUS_LABELS: Record<string, string> = {
  active: "ACTIVE",
  coming_soon: "COMING SOON",
  inactive: "INACTIVE",
};

/** 24h "HH:MM" -> "hh:mm AM/PM" */
function formatTime(t: string): string {
  const [hStr, m] = t.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

export const STATUS_STYLES: Record<string, string> = {
  active: "bg-sky-500/15 text-sky-600 border border-sky-600/30",
  coming_soon: "bg-amber-500/15 text-amber-700 border border-amber-500/30",
  inactive: "bg-[#E2E8F0] text-[#5B6B7C] border border-[#E2E8F0]",
};

export function formatMapUrl(clinic: Clinic): string | null {
  if (clinic.google_map_url) return clinic.google_map_url;
  if (clinic.latitude && clinic.longitude) {
    return `https://www.google.com/maps?q=${clinic.latitude},${clinic.longitude}`;
  }
  return null;
}

export default function ClinicCard({ clinic, onEdit, onDelete }: ClinicCardProps) {
  const mapUrl = formatMapUrl(clinic);

  const handleViewMap = () => {
    if (mapUrl) {
      window.open(mapUrl, "_blank", "noopener,noreferrer");
    } else {
      alert("Map location is not available.");
    }
  };

  // "Monday,Tuesday,..." -> "Monday to Saturday" style short label.
  const dayList = clinic.working_days
    .split(",")
    .filter((d) => (WORKING_DAYS as readonly string[]).includes(d));
  const workingDaysLabel =
    dayList.length === 7
      ? "Every day"
      : dayList.length > 2
        ? `${dayList[0]} to ${dayList[dayList.length - 1]}`
        : dayList.join(", ");

  return (
    <div className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-colors hover:border-sky-500/40">
      {/* Name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600">
            <Building2 size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {clinic.clinic_name}
            </h3>
            <p className="text-xs text-[#5B6B7C]">{clinic.city}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${STATUS_STYLES[clinic.status] ?? STATUS_STYLES.inactive}`}
        >
          {STATUS_LABELS[clinic.status] ?? clinic.status.toUpperCase()}
        </span>
      </div>

      {/* Details */}
      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex gap-2">
          <MapPin size={15} className="mt-0.5 shrink-0 text-sky-600" />
          <dd className="min-w-0 text-[#5B6B7C]">{clinic.full_clinic_address}</dd>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-xs text-[#83909D]">Working Days</span>
          <dd className="min-w-0 text-[#5B6B7C]">{workingDaysLabel}</dd>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-xs text-[#83909D]">Timing</span>
          <dd className="text-[#5B6B7C]">
            {clinic.opening_time && clinic.closing_time
              ? `${formatTime(clinic.opening_time)} - ${formatTime(clinic.closing_time)}`
              : "—"}
          </dd>
        </div>
        <div className="flex gap-2">
          <Phone size={15} className="mt-0.5 shrink-0 text-sky-600" />
          <dd className="text-[#5B6B7C]">{clinic.contact_number}</dd>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-xs text-[#83909D]">City Code</span>
          <dd className="rounded-md bg-[#F1F5F9] px-2 py-0.5 font-mono text-xs text-sky-600">
            {clinic.city_code}
          </dd>
        </div>
      </dl>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E2E8F0] pt-4">
        <button
          type="button"
          onClick={() => onEdit(clinic)}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
        >
          <Pencil size={13} /> Edit Clinic
        </button>
        <button
          type="button"
          onClick={handleViewMap}
          className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2 text-xs font-semibold text-[#5B6B7C] transition-colors hover:border-sky-500/40 hover:text-sky-600"
        >
          <Map size={13} /> View Map
        </button>
        <button
          type="button"
          onClick={() => onDelete(clinic)}
          className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2 text-xs font-semibold text-[#5B6B7C] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}
