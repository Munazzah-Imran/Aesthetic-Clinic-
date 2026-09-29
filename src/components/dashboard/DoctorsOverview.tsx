"use client";

import Link from "next/link";
import { Stethoscope } from "lucide-react";
import type { DashboardDoctor } from "@/lib/dashboardTypes";
import { initialsOf } from "@/lib/dashboardFormat";

type DoctorsOverviewProps = {
  doctors: DashboardDoctor[];
  /** True while the dashboard payload has not loaded yet. */
  loading?: boolean;
};

/** Title · specialty line with a clean "—" fallback when neither exists. */
function doctorSubtitle(doctor: DashboardDoctor): string {
  const parts = [doctor.professionalTitle, doctor.specialty]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      className="flex animate-pulse items-center gap-3 px-5 py-4"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="h-10 w-10 shrink-0 rounded-full bg-[#E2E8F0]" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 rounded bg-[#E2E8F0]" />
        <div className="h-3 w-1/2 rounded bg-[#E2E8F0]/70" />
      </div>
    </div>
  );
}

export default function DoctorsOverview({ doctors, loading = false }: DoctorsOverviewProps) {
  const isEmpty = !loading && doctors.length === 0;

  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Stethoscope size={18} className="text-sky-600" />
          <h2 className="text-sm font-semibold text-slate-900">Doctors Overview</h2>
        </div>
        <Link
          href="/dashboard/doctors"
          className="text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          View all
        </Link>
      </div>

      {/* Loading — subtle skeleton, never fake doctors */}
      {loading && (
        <div className="divide-y divide-[#E2E8F0]">
          <SkeletonRow index={0} />
          <SkeletonRow index={1} />
          <SkeletonRow index={2} />
        </div>
      )}

      {/* Empty state — doctors will appear here once added */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/15 text-sky-600">
            <Stethoscope size={20} />
          </div>
          <p className="text-sm font-medium text-slate-900">No doctors yet</p>
          <p className="max-w-xs text-xs text-[#5B6B7C]">
            Doctors you add will show up here.
          </p>
        </div>
      )}

      {/* Actual doctor records — newest first, limited server-side */}
      {!loading && doctors.length > 0 && (
        <div className="divide-y divide-[#E2E8F0]">
          {doctors.map((doctor) => (
            <div key={doctor.id} className="flex items-center gap-3 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-600">
                {initialsOf(doctor.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {doctor.fullName || "—"}
                </p>
                <p className="truncate text-xs text-[#5B6B7C]">
                  {doctorSubtitle(doctor)}
                </p>
              </div>
              <Stethoscope size={16} className="shrink-0 text-sky-700/70" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
